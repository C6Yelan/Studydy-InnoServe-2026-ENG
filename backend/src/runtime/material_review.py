"""Review the complete map before publication and archive source/proposal mappings privately."""
from copy import deepcopy
from collections import Counter
import time

from knowledge_map.material_review import (ReviewError, _pack_review, apply_review, combine_reviews,
                                          response_schema, validate_proposal)
from knowledge_map.structure import build_knowledge_structure_view, _revision
from pdf_evidence.ocr_page_evidence import canonical_sha256
from .semantic_service import request_semantics, semantic_client


def review_inputs(document):
    """Group contiguous source pages; assign cross-page concepts to their first page range."""
    view = build_knowledge_structure_view(document)
    binding = document['input_binding']
    sources = {s['source_id']: s for s in binding['manifest']['items']}
    evidence = {}
    for source in document['evidence']:
        e = {k: deepcopy(v) for k, v in source.items() if k != 'exact_text'}
        e['quote'] = source['exact_text']
        location = binding['bundle']['pages'][e['page'] - 1]
        e.update(source_id=location['source_id'], normalized_page=location['normalized_page'],
                 source_name=sources[location['source_id']]['original_name'])
        evidence[e['evidence_id']] = e
    for c in view['concepts']:
        for q in c['claims']:
            q['evidence'] = [deepcopy(evidence[e['evidence_id']]) for e in q['evidence']]
    owners = {}
    for c in view['concepts']:
        anchor = min((e for q in c['claims'] for e in q['evidence']), key=lambda e: (e['page'], e['block_order']))
        owners.setdefault((anchor['source_id'], anchor['page']), []).append(c)
    chunks, current, source_id, pages = [], [], None, []
    for (source, page), concepts in owners.items():
        # Split only at page boundaries; 40 is a batch target, not a concept-removal quota.
        if current and (source != source_id or len(current) + len(concepts) > 40):
            chunks.append((source_id, pages, current))
            current, pages = [], []
        source_id = source
        current.extend(concepts)
        pages.append(page)
    if current:
        chunks.append((source_id, pages, current))
    units = []
    for source, pages, concepts in chunks:
        refs = {e['evidence_id'] for c in concepts for q in c['claims'] for e in q['evidence']}
        context = [e for e in evidence.values() if e['evidence_id'] in refs or
                   (e['source_id'] == source and min(pages) <= e['page'] <= max(pages))]
        title = f"{context[0]['source_name']}: pages {min(e['normalized_page'] for e in context if e['source_id'] == source)}–{max(e['normalized_page'] for e in context if e['source_id'] == source)}"
        units.append(_pack_review(view, concepts, context, title))
    return view, units


def _checked_review(unit, index, lock, archive, client, check_cancel, wait_cancellation_check=None):
    """Repair coverage or source ownership once; never apply unverified proposals."""
    key = canonical_sha256({'source': unit.source_digest, 'request': unit.payload,
                            'policy': lock['material_review']})
    rejected = None
    rejection_code = None
    repairable = {'REVIEW_CONCEPT_COVERAGE_INVALID', 'REVIEW_CONCEPT_SUPPORT_INVALID'}

    def validate_saved(value):
        nonlocal rejected, rejection_code
        try:
            validate_proposal(unit, value)
        except ReviewError as error:
            if str(error) in repairable and rejected is None:
                rejected = deepcopy(value)
                rejection_code = str(error)
            raise

    response = archive.load_review(key, validate_response=validate_saved)
    if response is not None:
        validate_proposal(unit, response)
        return response, 0

    schema = response_schema()
    schema['properties']['assignments'].update(minItems=len(unit.concepts), maxItems=len(unit.concepts))
    schema['$defs']['Assignment']['properties']['concept']['enum'] = list(range(len(unit.concepts)))
    calls = 0

    def request_review(request, attempt):
        nonlocal calls
        check_cancel()
        archive.prepare_review_call(index, key, request, attempt=attempt)
        calls += 1
        value = request_semantics(client, runtime_lock=lock, task='material_review',
                                  request=request, response_schema=schema,
                                  cancellation_check=wait_cancellation_check or check_cancel)
        name = f'call-{index:06d}' + (f'-repair-{attempt:02d}' if attempt else '')
        archive.save_review(f'{name}/response', value)
        return value

    if rejected is None:
        response = request_review(unit.payload, 0)
        try:
            validate_saved(response)
        except ReviewError as error:
            if str(error) not in repairable:
                raise
    if rejected is not None:
        counts = Counter(row['concept'] for row in rejected['assignments'])
        expected = set(range(len(unit.concepts)))
        request = deepcopy(unit.payload)
        request['review_correction'] = {
            'error': rejection_code,
            'missing_concepts': sorted(expected - counts.keys()),
            'duplicate_concepts': sorted(h for h, count in counts.items() if count > 1),
            'unexpected_concepts': sorted(counts.keys() - expected),
            'unsupported_concepts': sorted({a['concept'] for a in rejected['assignments']
                if a['concept'] in expected and not set(a['evidence']) &
                set(unit.payload['concepts'][a['concept']]['evidence'])}),
            'concept_source_bindings': [{'concept': c['h'], 'evidence': c['evidence']} for c in unit.payload['concepts']],
            'previous_response': rejected,
            'instruction': 'The previous proposal failed validation and is not an answer key. Recheck conflicts and '
                           'omissions against the supplied sources and return a complete proposal. Reuse each input '
                           'concept handle h without renumbering. Include exactly one assignment per h, with at '
                           'least one evidence reference from its concept_source_bindings. Do not select the first '
                           'or last duplicate blindly or replace citations merely to hide incorrect ownership. '
                           'If the sources cannot resolve an issue, retain the concept as needs_review while '
                           'respecting all source and ownership constraints. Write generated explanations in English.',
        }
        response = request_review(request, 1)
        validate_proposal(unit, response)
    archive.save_review(f'cache-{key}', response)
    return response, calls


def review_structure(document, lock, archive, check_cancel, progress, *, wait_cancellation_check=None):
    """Reuse valid batches and bound coverage repair without repeating page analysis."""
    if 'material_review' not in lock:
        return document
    view, units = review_inputs(document)
    archive.save_review('source', document)
    started = time.monotonic()
    reviews, calls = [], 0
    with semantic_client() as client:
        for index, unit in enumerate(units, 1):
            check_cancel()
            response, new_calls = _checked_review(unit, index, lock, archive, client, check_cancel, wait_cancellation_check)
            calls += new_calls
            reviews.append((unit, response))
            progress('semantics', document['page_count'], document['page_count'])
    unit, proposal = combine_reviews(view, reviews)
    result, projection = apply_review(document, view, unit, proposal)
    # Response usage includes reuse; receipts count new requests separately.
    result['metrics']['semantic_calls'] += len(units)
    result['metrics']['semantic_duration_ms'] += round((time.monotonic() - started) * 1000)
    result['revision'] = _revision(result)
    archive.save_review('result', {'source_revision': document['revision'], 'applied_revision': result['revision'],
        'model_calls': calls, 'units': len(units), 'reused_batches': deepcopy(archive.review_reuses),
        'projection': projection, 'proposal': proposal})
    return result
