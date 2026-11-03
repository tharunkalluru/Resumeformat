# Independent M2 synthetic corpus

Ten fictional source files: six supported candidates, two readable layout-recovery candidates, two textless rejection candidates. Nine PDFs contain eleven known source pages; the DOCX has no native Word pagination oracle. See [manifest.json](manifest.json) for independently authored facts, headings, page geometry, long-bullet line counts, source hashes and scripted acceptance hooks.

Regenerate with `node scripts/create-m2-fixtures.mjs`. Sources use PDFKit 0.20.2 and direct OOXML with JSZip 3.10.2; they never import Folio renderer or importer code. The image-only scan is independently rasterized; the unreadable image deliberately has no legible facts. No fixtures are real applicant documents or actual participant usability evidence. Expected classifications are test candidates, not observed app outcomes. Do not report the old 111-test baseline as M2 acceptance.
