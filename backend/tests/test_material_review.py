from copy import deepcopy

import pytest

from knowledge_map.material_review import (
    ReviewError, _pack_review, project_review, validate_proposal, combine_reviews,
)
from structure_fixtures import build_knowledge_structure


def view():
    labels = ["Role category", "Role A", "Role B", "Course instructor", "Efficiency"]
    texts = [
        "Role category includes Role A and Role B.",
        "Role A provides information.",
        "Role B handles external communication.",
        "Course instructor: An instructor.",
        "Efficiency uses 8 resource units.",
    ]
    concepts = []
    for index, (label, text) in enumerate(zip(labels, texts)):
        evidence = {
            "evidence_id": f"e{index}", "source_id": "source",
            "source_name": "synthetic.pdf", "normalized_page": 1,
            "page": 1, "block_order": index, "kind": "paragraph", "quote": text,
        }
        concepts.append({
            "concept_id": f"c{index}", "label": label,
            "aliases": ["Efficiency", "Effectiveness"] if index == 4 else [],
            "section_ids": ["s0"],
            "claims": [{"claim_id": f"q{index}", "text": text, "evidence": [evidence]}],
        })
    return {
        "schema": "knowledge-structure-view/v1",
        "knowledge_structure_revision": "original",
        "concepts": concepts,
        "document_tree": {"sections": [{"section_id": "s0", "title": "Role category"}]},
        "relations": [
            {
                "relation_id": "r0", "source_concept_id": "c1", "target_concept_id": "c0",
                "type": "part_of", "learner_reason": "Role A belongs to the category.",
                "evidence_refs": ["e0", "e1"],
            },
            {
                "relation_id": "r1", "source_concept_id": "c2", "target_concept_id": "c0",
                "type": "part_of", "learner_reason": "Role B belongs to the category.",
                "evidence_refs": ["e0", "e2"],
            },
        ],
        "initial_learning_path": [
            {"position": index + 1, "concept_id": f"c{index}", "reason": "document_order"}
            for index in range(5)
        ],
    }


def prepare(document=None, first_page=1, last_page=1, title="Roles"):
    source_view = view() if document is None else document

    def in_scope(item):
        return item["source_id"] == "source" and first_page <= item["normalized_page"] <= last_page

    concepts = [
        concept for concept in source_view["concepts"]
        if any(in_scope(item) for claim in concept["claims"] for item in claim["evidence"])
    ]
    all_evidence = {
        item["evidence_id"]: item
        for concept in source_view["concepts"]
        for claim in concept["claims"]
        for item in claim["evidence"]
    }
    owned = {
        item["evidence_id"]
        for concept in concepts for claim in concept["claims"] for item in claim["evidence"]
    }
    evidence = sorted(
        (item for key, item in all_evidence.items() if key in owned or in_scope(item)),
        key=lambda item: (
            item["source_id"], item["normalized_page"], item["block_order"], item["evidence_id"],
        ),
    )
    return _pack_review(source_view, concepts, evidence, title)


def proposal():
    return {
        "assignments": [
            {
                "concept": index, "action": "keep", "target": None,
                "issue": "none", "reason": "The source defines this concept.", "evidence": [index],
            }
            for index in range(5)
        ],
        "alias_edits": [], "claim_edits": [], "relation_edits": [],
    }


def test_complete_unit_grouping_preserves_individual_points_sources_and_original():
    original = view()
    before = deepcopy(original)
    unit = prepare(original)
    response = proposal()
    for index in (1, 2):
        response["assignments"][index].update(
            action="group", target=0, issue="fragment", evidence=[0, index],
        )
    result = project_review(original, unit, response)
    assert original == before
    assert len(result["learning_units"]) == 3
    group = result["learning_units"][0]
    assert group["member_concept_ids"] == ["c0", "c1", "c2"]
    assert group["claim_ids"] == ["q0", "q1", "q2"]
    assert len(result["internalized_relations"]) == 2
    assert result["preserved_claim_ids"] == [f"q{index}" for index in range(5)]
    assert result["preserved_evidence_ids"] == [f"e{index}" for index in range(5)]
    assert result["publication_authorized"] is False


def test_applied_groups_are_valid_canonical_claims_with_new_ids_and_unchanged_evidence():
    from test_knowledge_structure_v1 import _block, _page
    from knowledge_map.structure import (SemanticState, build_document_context, apply_semantic_response,
                                         validate_knowledge_structure)
    from knowledge_map.material_review import apply_review
    from runtime.material_review import review_inputs
    context = build_document_context([_page(1, [_block(1, 0, 'paragraph', 'Management roles include Information sharing and External communication that handles external contact.'),
        _block(1, 1, 'paragraph', 'Information sharing distributes information.'),
        _block(1, 2, 'paragraph', 'External communication (Liaison) handles external contact.')])], page_count=1)
    state = SemanticState()
    apply_semantic_response({'concepts': [{'k': str(i), 'l': label, 'a': [], 'c': [{'m': None, 's': [i]}]}
        for i, label in enumerate(['Management roles', 'Information sharing', 'External communication'])], 'relations': []},
        context=context, bundle={'evidence': context['evidence'], 'sections': context['sections']}, state=state)
    doc = build_knowledge_structure(context, state, source_sha256='1'*64,
        run_id='00000000-0000-4000-8000-000000000001', produced_at='2026-09-21T00:00:00+00:00',
        runtime_lock_sha256='2'*64, model_id='google/gemma-4-31B-it-qat-w4a16-ct',
        model_revision='52f3f65bc7a02d555763bc923bd1d9094898219d', semantic_calls=1, ocr_calls=0)
    before = deepcopy(doc)
    view, units = review_inputs(doc)
    unit = units[0]
    response = {'assignments': [{'concept': c['h'], 'action': 'keep' if i == 0 else 'group',
                 'target': None if i == 0 else 0, 'issue': 'none' if i == 0 else 'fragment',
                 'reason': 'The source lists roles in one category.', 'evidence': c['evidence']}
                for i, c in enumerate(unit.payload['concepts'])],
                'alias_edits': [], 'claim_edits': [{'claim': 2, 'meaning': 'External communication handles external contact.',
                    'evidence': [0], 'reason': 'The attempted correction omits a cited technical name.'}], 'relation_edits': []}
    applied, audit = apply_review(doc, view, unit, response)
    assert doc == before and applied['evidence'] == doc['evidence']
    assert validate_knowledge_structure(applied) and len(applied['concepts']) == 1
    assert len(applied['concepts'][0]['claims']) == 3
    assert applied['revision'] != doc['revision']
    assert set(audit['claim_mapping']) == {q['claim_id'] for c in doc['concepts'] for q in c['claims']}
    assert any(e['reason'] == 'CANONICAL_LITERAL_GUARD' for e in audit['blocked_changes'])


def test_examples_remain_attached_and_metadata_does_not_remove_source_content():
    response = proposal()
    response["assignments"][1].update(action="example", target=0, issue="case", evidence=[0, 1])
    response["assignments"][3].update(action="metadata", issue="author")
    result = project_review(view(), prepare(), response)
    assert result["learning_units"][0]["example_concept_ids"] == ["c1"]
    assert result["metadata_concept_ids"] == ["c3"]
    assert set(result["preserved_evidence_ids"]) == {f"e{index}" for index in range(5)}


def test_section_topic_cannot_be_discarded_as_cover_noise():
    response = proposal()
    response["assignments"][0].update(action="metadata", issue="layout")
    result = project_review(view(), prepare(), response)
    assert len(result["learning_units"]) == 5
    assert result["blocked_changes"][0]["concept_id"] == "c0"
    assert result["findings"][0]["concept_id"] == "c0"


@pytest.mark.parametrize("source_text, proposed", [
    ("Efficiency↑", "Efficiency is an analysis factor."),
    ("Bargaining power↓", "Bargaining power↑"),
    ("Condition≤8", "Condition≥8"),
])
def test_claim_correction_preserves_direction_and_inequality(source_text, proposed):
    from knowledge_map.material_review import ClaimEdit, _corrected_claim

    edit = ClaimEdit(claim=0, evidence=[0], reason="Source correction", meaning=proposed)
    evidence = [{"evidence_id": "e", "kind": "paragraph", "quote": source_text}]
    assert _corrected_claim(edit, evidence) is None


@pytest.mark.parametrize("bad", ["missing", "duplicate", "unknown_evidence", "cycle", "self"])
def test_invalid_scope_or_unsafe_grouping_is_rejected(bad):
    response = proposal()
    if bad == "missing":
        response["assignments"].pop()
    elif bad == "duplicate":
        response["assignments"][-1] = deepcopy(response["assignments"][0])
    elif bad == "unknown_evidence":
        response["assignments"][0]["evidence"] = [99]
    elif bad == "self":
        response["assignments"][0].update(action="group", target=0)
    else:
        response["assignments"][1].update(action="group", target=0, evidence=[0, 1])
        response["assignments"][0].update(action="group", target=1, evidence=[0, 1])
    with pytest.raises(ReviewError):
        validate_proposal(prepare(), response)


def test_parent_source_binding_is_derived_without_inventing_model_citations():
    response = proposal()
    response["assignments"][1].update(action="group", target=0, issue="fragment")
    result = project_review(view(), prepare(), response)
    binding = next(item for item in result["assignments"] if item["concept_id"] == "c1")
    assert binding["model_evidence_ids"] == ["e1"]
    assert binding["source_evidence_ids"] == ["e1"]
    assert binding["target_evidence_ids"] == ["e0"]


def test_nested_parent_is_preserved_instead_of_flattening_the_whole_lesson():
    response = proposal()
    response["assignments"][1].update(action="group", target=0, issue="fragment")
    response["assignments"][2].update(action="group", target=1, issue="fragment")
    result = project_review(view(), prepare(), response)
    assert any(
        unit["concept_id"] == "c1" and unit["member_concept_ids"] == ["c1", "c2"]
        for unit in result["learning_units"]
    )
    assert result["blocked_changes"][0]["reason"] == "PARENT_KEPT_AS_LEARNING_UNIT"


def test_internalizing_an_example_does_not_hide_an_existing_wrong_direction():
    document = view()
    document["relations"][0]["type"] = "example"
    response = proposal()
    response["assignments"][1].update(action="example", target=0, issue="case")
    result = project_review(document, prepare(document), response)
    assert any(finding.get("relation_id") == "r0" for finding in result["findings"])


def test_alias_removal_only_changes_projection_and_cannot_invent_aliases():
    response = proposal()
    response["alias_edits"] = [{
        "concept": 4, "remove": ["Effectiveness"],
        "reason": "The source says Efficiency.", "evidence": [4],
    }]
    document = view()
    result = project_review(document, prepare(document), response)
    assert result["learning_units"][-1]["aliases"] == ["Efficiency"]
    assert document["concepts"][-1]["aliases"] == ["Efficiency", "Effectiveness"]
    response["alias_edits"][0]["remove"] = ["invented"]
    with pytest.raises(ReviewError, match="ALIAS"):
        project_review(document, prepare(document), response)


def test_claim_correction_cannot_change_source_number():
    response = proposal()
    response["claim_edits"] = [{
        "claim": 4, "meaning": "Efficiency uses 9 resource units.",
        "reason": "Correct the quantity.", "evidence": [4],
    }]
    result = project_review(view(), prepare(), response)
    assert result["claim_changes"] == []
    assert result["blocked_changes"][0]["reason"] == "CLAIM_CORRECTION_NOT_SUPPORTED"
    response["claim_edits"][0]["meaning"] = "Efficiency uses 8 resource units"
    assert len(project_review(view(), prepare(), response)["claim_changes"]) == 1


def test_claim_correction_cannot_introduce_an_uncited_other_concept():
    response = proposal()
    response["claim_edits"] = [{
        "claim": 1, "meaning": "Role A is also Role B.",
        "reason": "Complete the relation.", "evidence": [1],
    }]
    result = project_review(view(), prepare(), response)
    assert result["claim_changes"] == []
    assert result["blocked_changes"][0]["reason"] == "CLAIM_REFERENT_NOT_CITED"
    assert result["blocked_changes"][0]["concepts"] == ["Role B"]


def test_claim_can_name_its_existing_owner_without_repeating_the_heading_citation():
    document = view()
    document["concepts"][4]["label"] = "\u6548\u7387"
    claim = document["concepts"][4]["claims"][0]
    claim["text"] = "\u6bcf\u6b21\u4f7f\u75288\u500b\u8cc7\u6e90\u55ae\u4f4d。"
    claim["evidence"][0]["quote"] = claim["text"]
    response = proposal()
    response["claim_edits"] = [{
        "claim": 4, "meaning": "\u6548\u7387\u70ba\u6bcf\u6b21\u4f7f\u75288\u500b\u8cc7\u6e90\u55ae\u4f4d。",
        "reason": "\u88dc\u4e0a\u6240\u5c6c\u89c0\u5ff5\u540d\u7a31。", "evidence": [4],
    }]
    assert len(project_review(document, prepare(document), response)["claim_changes"]) == 1


@pytest.mark.parametrize("source,meaning,kind,allowed", [
    ("\u7ba1\u7406\u5faa\u74b0(PDCA) \u5305\u542b Plan Do Check Action", "\u7ba1\u7406\u5faa\u74b0（PDCA）\u5305\u542b Plan、Do、Check、Action。", "paragraph", True),
    ("\u547c\u53eb f(x)", "\u6539\u70ba f(y)", "paragraph", False),
    ("f(x)", "\u547c\u53eb f(x)", "code", False),
    ("\u516c\u5f0f(x)", "\u516c\u5f0f\u6539\u70bax", "paragraph", False),
    ("\u6548\u7387(Efficiency)", "\u6548\u7387（Effectiveness）", "paragraph", False),
])
def test_prose_gloss_correction_does_not_weaken_code_or_identifier_protection(source, meaning, kind, allowed):
    document = view()
    claim = document["concepts"][4]["claims"][0]
    claim["text"] = source
    claim["evidence"][0].update(quote=source, kind=kind)
    response = proposal()
    response["claim_edits"] = [{
        "claim": 4, "meaning": meaning, "reason": "Clarify the wording.", "evidence": [4],
    }]
    result = project_review(document, prepare(document), response)
    assert bool(result["claim_changes"]) is allowed


def test_relation_reverse_and_prerequisite_integrity():
    document = view()
    document["relations"][0]["type"] = "example"
    response = proposal()
    response["relation_edits"] = [{
        "relation": 0, "action": "reverse", "relation_type": "example",
        "reason": "The category points to its example.", "evidence": [0, 1],
    }]
    result = project_review(document, prepare(document), response)
    assert result["relations"][0]["source_concept_id"] == "c0"
    assert document["relations"][0]["source_concept_id"] == "c1"
    response["relation_edits"][0]["relation_type"] = "part_of"
    with pytest.raises(ReviewError, match="RELATION_EDIT_INVALID"):
        project_review(document, prepare(document), response)
    document["relations"][0]["type"] = "prerequisite"
    response["relation_edits"] = []
    response["assignments"][1].update(
        action="group", target=0, issue="fragment", evidence=[0, 1],
    )
    result = project_review(document, prepare(document), response)
    assert result["relations"][0]["source_concept_id"] == "c1"
    assert result["relations"][0]["target_concept_id"] == "c0"
    assert result["blocked_changes"][0]["reason"] == "PREREQUISITE_ENDPOINT_KEPT"
    assert any(unit["concept_id"] == "c1" for unit in result["learning_units"])


def test_removing_wrong_parent_can_use_same_page_heading_context_but_not_unrelated_page():
    document = view()
    document['concepts'][4]['claims'][0]['evidence'][0]['kind'] = 'heading'
    response = proposal()
    response['relation_edits'] = [{'relation': 0, 'action': 'remove', 'relation_type': None,
        'reason': 'The section on the same page shows an incorrect connection.', 'evidence': [1, 4]}]
    assert len(project_review(document, prepare(document), response)['excluded_relations']) == 1
    document['concepts'][4]['claims'][0]['evidence'][0]['normalized_page'] = 2
    unit = prepare(document, 1, 2)
    with pytest.raises(ReviewError, match='RELATION_EDIT_INVALID'):
        project_review(document, unit, response)


def test_response_is_bound_to_the_exact_original_view():
    document = view()
    unit = prepare(document)
    document["concepts"][0]["claims"][0]["text"] = "changed"
    with pytest.raises(ReviewError, match="SOURCE_CHANGED"):
        project_review(document, unit, proposal())


def test_blocked_prerequisite_removal_preserves_its_original_reason():
    document = view()
    document["relations"][0]["type"] = "prerequisite"
    response = proposal()
    response["relation_edits"] = [{
        "relation": 0, "action": "remove", "relation_type": None,
        "reason": "Remove this relation.", "evidence": [0, 1],
    }]
    result = project_review(document, prepare(document), response)
    assert result["relations"][0]["reason"] == document["relations"][0]["learner_reason"]
    assert result["relations"][0]["type"] == "prerequisite"
    assert result["blocked_changes"][0]["reason"] == "PREREQUISITE_REMOVAL_REQUIRES_REVIEW"


def test_combining_disjoint_units_remaps_handles_and_rejects_overlapping_opinions():
    document = view()
    for page, concept in enumerate(document["concepts"], 1):
        concept["claims"][0]["evidence"][0]["normalized_page"] = page
    first = prepare(document, 1, 3)
    second = prepare(document, 4, 5, "Other")

    def keep(unit):
        return {
            "assignments": [
                {
                    "concept": index, "action": "keep", "target": None,
                    "issue": "none", "reason": "Keep.", "evidence": concept["evidence"],
                }
                for index, concept in enumerate(unit.payload["concepts"])
            ],
            "alias_edits": [], "claim_edits": [], "relation_edits": [],
        }

    first_response, second_response = keep(first), keep(second)
    first_response["assignments"][1].update(action="group", target=0, issue="fragment")
    second_response["alias_edits"] = [{
        "concept": 1, "remove": ["Effectiveness"],
        "evidence": [1], "reason": "Misplaced alias.",
    }]
    merged, response = combine_reviews(
        document, [(first, first_response), (second, second_response)],
    )
    result = project_review(document, merged, response)
    assert len(result["learning_units"]) == 4
    assert result["alias_changes"][0]["concept_id"] == "c4"
    assert result["learning_units"][-1]["aliases"] == ["Efficiency"]
    with pytest.raises(ReviewError, match="SCOPES_OVERLAP"):
        combine_reviews(document, [(first, first_response), (first, first_response)])
