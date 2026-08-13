def save_billing_statement_workflow(conn, statement, lines, actor, note, deps):
    source_type = deps["normalize_workflow_source"](statement.get("sourceType", ""))
    scope_type, scope_key = deps["workflow_scope_for_statement"](statement)
    business_key = deps["billing_workflow_business_key"](scope_type, scope_key, statement.get("month", ""), source_type)
    existing = deps["get_billing_workflow_by_key"](conn, business_key)
    generated_at = statement.get("generatedAt") or deps["now_iso"]()
    default_note = note or "生成饲养费结算单"
    events = []

    if not existing:
        workflow_id = deps["new_id"]("bwf")
        version_id = deps["new_id"]("stmt")
        version_no = 1
        lines = [{**line, "statementId": version_id} for line in lines]
        document_number = deps["make_statement_document_number"](statement, version_no)
        statement = deps["enrich_statement_for_workflow"](
            statement,
            workflow_id=workflow_id,
            version_id=version_id,
            version_no=version_no,
            version_status=deps["VERSION_STATUS_ACTIVE"],
            workflow_status=deps["WORKFLOW_STATUS_GENERATED"],
            document_number=document_number,
        )
        version_payload = deps["build_version_payload"](
            statement,
            workflow_id,
            version_no,
            deps["VERSION_STATUS_ACTIVE"],
            deps["WORKFLOW_STATUS_GENERATED"],
            generated_at,
            "",
            "",
            "",
        )
        workflow_payload = deps["build_workflow_payload"](
            workflow_id,
            statement.get("iacuc", ""),
            statement.get("month", ""),
            source_type,
            deps["WORKFLOW_STATUS_GENERATED"],
            version_payload,
            generated_at,
        )
        deps["insert_billing_workflow"](conn, workflow_payload)
        deps["insert_billing_version"](conn, version_payload)
        deps["replace_version_lines"](conn, version_id, lines)
        event = deps["build_workflow_event_payload"](
            deps["new_id"]("wevt"),
            workflow_id,
            version_id,
            "statement_generated",
            "",
            deps["WORKFLOW_STATUS_GENERATED"],
            actor,
            generated_at,
            "manual",
            default_note,
        )
        deps["insert_billing_workflow_event"](conn, event)
        events.append(event)
        return workflow_payload, version_payload, statement, lines, events

    workflow_id = existing["id"]
    current_version = existing.get("currentVersion") or {}
    current_version_id = current_version.get("id")
    current_workflow_status = existing.get("workflowStatus", deps["WORKFLOW_STATUS_GENERATED"])

    if current_workflow_status == deps["WORKFLOW_STATUS_GENERATED"] and current_version_id:
        version_id = current_version_id
        version_no = int(current_version.get("versionNo") or existing.get("currentVersionNo") or 1)
        lines = [{**line, "statementId": version_id} for line in lines]
        document_number = current_version.get("documentNumber") or deps["make_statement_document_number"](
            statement, version_no
        )
        statement = deps["enrich_statement_for_workflow"](
            statement,
            workflow_id=workflow_id,
            version_id=version_id,
            version_no=version_no,
            version_status=deps["VERSION_STATUS_ACTIVE"],
            workflow_status=deps["WORKFLOW_STATUS_GENERATED"],
            document_number=document_number,
        )
        version_payload = deps["build_version_payload"](
            statement,
            workflow_id,
            version_no,
            deps["VERSION_STATUS_ACTIVE"],
            deps["WORKFLOW_STATUS_GENERATED"],
            generated_at,
            "",
            "",
            "",
        )
        deps["update_billing_version"](conn, version_payload)
        deps["replace_version_lines"](conn, version_id, lines)
        workflow_payload = deps["build_workflow_payload"](
            workflow_id,
            statement.get("iacuc", ""),
            statement.get("month", ""),
            source_type,
            deps["WORKFLOW_STATUS_GENERATED"],
            version_payload,
            generated_at,
        )
        deps["update_billing_workflow"](conn, workflow_payload)
        event = deps["build_workflow_event_payload"](
            deps["new_id"]("wevt"),
            workflow_id,
            version_id,
            "statement_generated",
            deps["WORKFLOW_STATUS_GENERATED"],
            deps["WORKFLOW_STATUS_GENERATED"],
            actor,
            generated_at,
            "manual",
            default_note,
        )
        deps["insert_billing_workflow_event"](conn, event)
        events.append(event)
        return workflow_payload, version_payload, statement, lines, events

    void_at = generated_at
    if current_version_id:
        previous = deps["get_billing_version"](conn, current_version_id) or current_version
        previous_statement = dict(previous.get("statement") or {})
        previous_statement["workflowStatus"] = current_workflow_status
        previous_payload = deps["build_version_payload"](
            previous_statement,
            workflow_id,
            int(previous.get("versionNo") or existing.get("currentVersionNo") or 1),
            deps["VERSION_STATUS_VOIDED"],
            current_workflow_status,
            previous.get("generatedAt") or generated_at,
            void_at,
            actor.get("displayName", ""),
            note or "根据更正数据生成修订版",
        )
        deps["update_billing_version"](conn, previous_payload)
        void_event = deps["build_workflow_event_payload"](
            deps["new_id"]("wevt"),
            workflow_id,
            current_version_id,
            "statement_voided",
            current_workflow_status,
            current_workflow_status,
            actor,
            void_at,
            "manual",
            note or "旧版本作废，生成修订版",
        )
        deps["insert_billing_workflow_event"](conn, void_event)
        events.append(void_event)

    version_no = int(existing.get("currentVersionNo") or 0) + 1
    version_id = deps["new_id"]("stmt")
    lines = [{**line, "statementId": version_id} for line in lines]
    document_number = deps["make_statement_document_number"](statement, version_no)
    statement = deps["enrich_statement_for_workflow"](
        statement,
        workflow_id=workflow_id,
        version_id=version_id,
        version_no=version_no,
        version_status=deps["VERSION_STATUS_ACTIVE"],
        workflow_status=deps["WORKFLOW_STATUS_GENERATED"],
        document_number=document_number,
    )
    version_payload = deps["build_version_payload"](
        statement,
        workflow_id,
        version_no,
        deps["VERSION_STATUS_ACTIVE"],
        deps["WORKFLOW_STATUS_GENERATED"],
        generated_at,
        "",
        "",
        "",
    )
    deps["insert_billing_version"](conn, version_payload)
    deps["replace_version_lines"](conn, version_id, lines)
    workflow_payload = deps["build_workflow_payload"](
        workflow_id,
        statement.get("iacuc", ""),
        statement.get("month", ""),
        source_type,
        deps["WORKFLOW_STATUS_GENERATED"],
        version_payload,
        generated_at,
    )
    deps["update_billing_workflow"](conn, workflow_payload)
    revise_event = deps["build_workflow_event_payload"](
        deps["new_id"]("wevt"),
        workflow_id,
        version_id,
        "statement_revised",
        current_workflow_status,
        deps["WORKFLOW_STATUS_GENERATED"],
        actor,
        generated_at,
        "manual",
        note or "基于当前有效版本生成修订版",
    )
    deps["insert_billing_workflow_event"](conn, revise_event)
    events.append(revise_event)
    return workflow_payload, version_payload, statement, lines, events


def update_workflow_status(conn, workflow_id, next_status, actor, note, deps, registration=None):
    workflow = deps["get_billing_workflow"](conn, workflow_id)
    if not workflow:
        raise LookupError("结算流程不存在")
    current_status = workflow.get("workflowStatus", deps["WORKFLOW_STATUS_GENERATED"])
    allowed_transitions = {
        (deps["WORKFLOW_STATUS_GENERATED"], deps["WORKFLOW_STATUS_SENT"]),
        (deps["WORKFLOW_STATUS_SENT"], deps["WORKFLOW_STATUS_ARCHIVED"]),
        (deps["WORKFLOW_STATUS_SENT"], deps["WORKFLOW_STATUS_GENERATED"]),
        (deps["WORKFLOW_STATUS_ARCHIVED"], deps["WORKFLOW_STATUS_SENT"]),
        (deps["WORKFLOW_STATUS_ARCHIVED"], deps["WORKFLOW_STATUS_LOCKED"]),
        (deps["WORKFLOW_STATUS_LOCKED"], deps["WORKFLOW_STATUS_ARCHIVED"]),
    }
    if (current_status, next_status) not in allowed_transitions:
        if current_status in (
            deps.get("WORKFLOW_STATUS_SIGNED", "statement_signed_returned"),
            deps.get("WORKFLOW_STATUS_FINANCE", "submitted_to_finance"),
            deps.get("WORKFLOW_STATUS_ARCHIVED", "statement_archived"),
            deps.get("WORKFLOW_STATUS_LOCKED", "statement_locked"),
        ):
            raise ValueError("该流程已结束或已锁定，仅可查看归档")
        raise ValueError("当前流程状态不允许执行该操作")

    version = deps["get_billing_version"](conn, workflow.get("currentVersionId", ""))
    if not version:
        raise LookupError("当前有效结算单不存在")
    statement = dict(version.get("statement") or {})
    at = deps["now_iso"]()
    statement["workflowStatus"] = next_status
    if next_status == deps["WORKFLOW_STATUS_SENT"]:
        statement["sentAt"] = at
        statement["sentBy"] = {
            "id": actor.get("id", ""),
            "username": actor.get("username", ""),
            "displayName": actor.get("displayName", ""),
        }
        if current_status == deps["WORKFLOW_STATUS_ARCHIVED"]:
            statement["revertedAt"] = at
            statement["revertedBy"] = {
                "id": actor.get("id", ""),
                "username": actor.get("username", ""),
                "displayName": actor.get("displayName", ""),
            }
    elif next_status == deps["WORKFLOW_STATUS_GENERATED"] and current_status == deps["WORKFLOW_STATUS_SENT"]:
        statement["revertedAt"] = at
        statement["revertedBy"] = {
            "id": actor.get("id", ""),
            "username": actor.get("username", ""),
            "displayName": actor.get("displayName", ""),
        }
    elif next_status == deps["WORKFLOW_STATUS_ARCHIVED"]:
        statement["signedReturnedAt"] = at
        statement["archivedAt"] = at
        if current_status == deps["WORKFLOW_STATUS_LOCKED"]:
            # 解锁：保留已归档登记信息，仅记录解锁人/时间。
            statement["unlockedAt"] = at
            statement["unlockedBy"] = {
                "id": actor.get("id", ""),
                "username": actor.get("username", ""),
                "displayName": actor.get("displayName", ""),
            }
        else:
            statement.pop("unlockedAt", None)
            statement.pop("unlockedBy", None)
            registration = registration or {}
            reimbursement_forms = []
            for entry in registration.get("reimbursementForms") or []:
                form_no = deps["clean_text"](entry.get("formNo", ""))
                amount = max(deps["as_int"](entry.get("amount")) or 0, 0)
                if form_no:
                    reimbursement_forms.append({"formNo": form_no, "amount": amount})
            statement["signedStatementReturned"] = bool(registration.get("signedStatementReturned"))
            statement["reimbursementFormReturned"] = bool(registration.get("reimbursementFormReturned"))
            if statement["reimbursementFormReturned"] and not reimbursement_forms:
                raise ValueError("交回报销单时必须填写报销单号和金额")
            statement["reimbursementForms"] = reimbursement_forms
            statement["reimbursementFormNos"] = [entry["formNo"] for entry in reimbursement_forms]
            statement["receivedAmount"] = sum(entry["amount"] for entry in reimbursement_forms)
            statement["attachments"] = list(registration.get("attachments") or [])
            statement["registeredBy"] = {
                "id": actor.get("id", ""),
                "username": actor.get("username", ""),
                "displayName": actor.get("displayName", ""),
            }
            statement["registeredAt"] = at
    elif next_status == deps["WORKFLOW_STATUS_LOCKED"]:
        statement["lockedAt"] = at
        statement["lockedBy"] = {
            "id": actor.get("id", ""),
            "username": actor.get("username", ""),
            "displayName": actor.get("displayName", ""),
        }
    updated_version = deps["build_version_payload"](
        statement,
        workflow_id,
        version.get("versionNo", 1),
        version.get("versionStatus", deps["VERSION_STATUS_ACTIVE"]),
        next_status,
        version.get("generatedAt", at),
        version.get("voidedAt", ""),
        version.get("voidedBy", ""),
        version.get("voidReason", ""),
    )
    deps["update_billing_version"](conn, updated_version)
    updated_workflow = deps["build_workflow_payload"](
        workflow_id,
        workflow.get("iacuc", ""),
        workflow.get("month", ""),
        workflow.get("sourceType", ""),
        next_status,
        updated_version,
        at,
    )
    deps["update_billing_workflow"](conn, updated_workflow)
    if next_status == deps["WORKFLOW_STATUS_SENT"] and current_status == deps["WORKFLOW_STATUS_ARCHIVED"]:
        event_type = "statement_archived_reverted"
    elif next_status == deps["WORKFLOW_STATUS_GENERATED"] and current_status == deps["WORKFLOW_STATUS_SENT"]:
        event_type = "statement_sent_reverted"
    elif next_status == deps["WORKFLOW_STATUS_ARCHIVED"] and current_status == deps["WORKFLOW_STATUS_LOCKED"]:
        event_type = "statement_unlocked"
    else:
        event_type = {
            deps["WORKFLOW_STATUS_SENT"]: "statement_sent",
            deps["WORKFLOW_STATUS_ARCHIVED"]: "statement_registered_archived",
            deps["WORKFLOW_STATUS_LOCKED"]: "statement_locked",
        }[next_status]
    event = deps["build_workflow_event_payload"](
        deps["new_id"]("wevt"),
        workflow_id,
        updated_version["id"],
        event_type,
        current_status,
        next_status,
        actor,
        at,
        "manual",
        note,
    )
    deps["insert_billing_workflow_event"](conn, event)
    return updated_workflow, updated_version, event


def record_archived_reimbursement(conn, workflow_id, reimbursement_forms, actor, note, deps):
    workflow = deps["get_billing_workflow"](conn, workflow_id)
    if not workflow:
        raise LookupError("结算流程不存在")
    if workflow.get("workflowStatus", "") not in (
        deps["WORKFLOW_STATUS_ARCHIVED"],
        deps["WORKFLOW_STATUS_LOCKED"],
    ):
        raise ValueError("仅已归档或已锁定流程可以补录报销单")
    version = deps["get_billing_version"](conn, workflow.get("currentVersionId", ""))
    if not version:
        raise LookupError("当前有效结算单不存在")
    forms = []
    for entry in reimbursement_forms or []:
        form_no = deps["clean_text"](entry.get("formNo", ""))
        amount = max(deps["as_int"](entry.get("amount")) or 0, 0)
        if form_no:
            forms.append({"formNo": form_no, "amount": amount})
    if not forms:
        raise ValueError("请填写报销单号和金额")
    statement = dict(version.get("statement") or {})
    merged_forms = list(statement.get("reimbursementForms") or []) + forms
    at = deps["now_iso"]()
    statement["workflowStatus"] = deps["WORKFLOW_STATUS_ARCHIVED"]
    statement["reimbursementForms"] = merged_forms
    statement["reimbursementFormNos"] = [entry["formNo"] for entry in merged_forms]
    statement["reimbursementFormReturned"] = True
    statement["receivedAmount"] = sum(entry["amount"] for entry in merged_forms)
    statement["reimbursementRecordedAt"] = at
    statement["reimbursementRecordedBy"] = {
        "id": actor.get("id", ""),
        "username": actor.get("username", ""),
        "displayName": actor.get("displayName", ""),
    }
    updated_version = deps["build_version_payload"](
        statement,
        workflow_id,
        version.get("versionNo", 1),
        version.get("versionStatus", deps["VERSION_STATUS_ACTIVE"]),
        deps["WORKFLOW_STATUS_ARCHIVED"],
        version.get("generatedAt", at),
        version.get("voidedAt", ""),
        version.get("voidedBy", ""),
        version.get("voidReason", ""),
    )
    deps["update_billing_version"](conn, updated_version)
    updated_workflow = deps["build_workflow_payload"](
        workflow_id,
        workflow.get("iacuc", ""),
        workflow.get("month", ""),
        workflow.get("sourceType", ""),
        deps["WORKFLOW_STATUS_ARCHIVED"],
        updated_version,
        at,
    )
    deps["update_billing_workflow"](conn, updated_workflow)
    event = deps["build_workflow_event_payload"](
        deps["new_id"]("wevt"),
        workflow_id,
        updated_version["id"],
        "statement_reimbursement_recorded",
        deps["WORKFLOW_STATUS_ARCHIVED"],
        deps["WORKFLOW_STATUS_ARCHIVED"],
        actor,
        at,
        "manual",
        note or "补录报销单",
    )
    deps["insert_billing_workflow_event"](conn, event)
    return updated_workflow, updated_version, event
