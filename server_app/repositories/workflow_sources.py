"""Fee-family filters preserve the existing source identifiers."""


def append_workflow_source_filter(clauses, params, source):
    if source:
        clauses.append("source_type <> ?" if source == "feeding" else "source_type = ?")
        params.append("pi_merged_technical_service" if source == "feeding" else source)


def source_fee_type(source):
    return "technical_service" if source == "pi_merged_technical_service" else "feeding"
