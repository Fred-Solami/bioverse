-- 0011_patient_links.sql  (v0.2 identity — reversible record links)
-- When a human confirms two patient records are the same person (review queue
-- LINKED), the duplicate points at the survivor via linked_to. Non-destructive:
-- both rows survive, the link is provenance-tracked and reversed by setting
-- linked_to = NULL (DESIGN.md §11.3 — "merges reversible; a wrong merge is
-- worse than a duplicate"). An identifier value can't be shared across records
-- (patient_identifiers is globally unique), so the link lives here, not there.
ALTER TABLE patients
  ADD COLUMN linked_to UUID REFERENCES patients(id),
  ADD COLUMN linked_at TIMESTAMPTZ,
  ADD COLUMN linked_by UUID REFERENCES users(id);

CREATE INDEX idx_patients_linked_to ON patients(linked_to);
