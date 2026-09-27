# Limitations

[Documentation](../README.md) · [Testing](testing.md)

## Deployment

Linux containers, Docker, kernel namespace support, and Linux filesystem permissions are required. The semantic model runs as a separately configured service. No native Windows/macOS launcher is provided, and deployment is not tied to SSH or RunPod.

The default website binds to loopback with non-Secure cookies. Public hosting requires TLS, the correct origin, and Secure cookies. Operators provide model credentials and host capabilities.

## Documents and extraction

The 100 MiB file limit does not guarantee successful conversion. Office fonts, charts, formulas, and layout can change. DOC/PPT provide converted-page locations only, and DOCX paragraph mappings can be ambiguous.

Markdown does not load images or execute raw HTML. Protected, corrupt, active, or externally linked documents may be rejected.

This edition extracts native text only. Image and scanned text is not recognized; charts, formulas, or image-only sources may contain no usable evidence. Use PDFs with a text layer when that content must be analyzed.

Subprocess time and resource limits apply. NPROC is per UID rather than an aggregate job quota.

## Model and learning quality

Check generated concepts, claims, relations, and questions against sources, especially grouped-concept scope, relationship direction, and question ambiguity. Programmatic checks cannot prove all retained semantics correct.

Material-review acceptance requires at least 85% usability together with source/version binding, complete paths, honest failures, private-answer protection, no observed false mastery decisions, and runtime availability. This requirement is not a claim that all content has passed.

Partial and needs_review content needs human review. Quality warnings are not yet consistently carried into map and study views. Review does not merge concepts across batches, and literal/prerequisite protection may retain fragments or reject reasonable rewrites. Sets may contain only a subset of requested questions when no safe candidate is available.

Passing a check, passing assisted follow-up, and long-term mastery are different outcomes. Changed models, revisions, or prompts need new validation; results from other languages or materials do not establish English content quality.

## Data and features

Generated learner-facing text is English; exact quotations and answer spans retain their source language. A non-English source can therefore remain visible in source panels or literal answers.

Originals and persistent data remain on the host, while AI operations send necessary content to the configured service. Accounts have no email ownership verification, password reset, OAuth, or MFA.

Material re-review has an API but no dedicated UI. Closing a page does not cancel work, and cancellation does not guarantee interruption of in-flight inference. Controls on unavailable-resource pages and cancellation wording still have known presentation limitations.

## Coverage

Automated checks use synthetic data, controlled models, isolated databases, and browsers. They do not cover every device, file, or input. There is no complete real-API browser fixture covering append followed by UI inheritance; separate lower-level tests are not equivalent to that full flow.

Basic checks do not establish full security, compatibility, semantic quality, or release acceptance. The English edition requires its own browser and model acceptance before release.
