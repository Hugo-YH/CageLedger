# Task Dependency Graph

```mermaid
graph TD
    subgraph Phase1["Phase 1: Contract Baseline"]
        T11["1.1 Frontend State Contract"]
        T12["1.2 API Contracts"]
        T13["1.3 Module Boundaries"]
        C1["docs/contracts/frontend-state.md"]
        C2["docs/contracts/api-contracts.md"]
        C3["docs/contracts/module-boundaries.md"]
        T11 --> C1
        T12 --> C2
        C1 --> T13
        C2 --> T13
        T13 --> C3
    end

    subgraph Phase2["Phase 2: Backend Decomposition"]
        T21["2.1 Config / DB / Cache / Response"]
        T22["2.2 Repository Layer"]
        T23["2.3 Service Layer"]
        T21 --> T22
        T22 --> T23
    end

    subgraph Phase3["Phase 3: Frontend Decomposition"]
        T31["3.1 API Client"]
        T32["3.2 State Slices"]
        T33["3.3 View Modules"]
        T31 --> T33
        T32 --> T33
    end

    subgraph Phase4["Phase 4: Validation and Release Hardening"]
        T41["4.1 API / Migration Samples"]
        T42["4.2 Frontend Acceptance Checks"]
        T43["4.3 Release / Package / Wiki Contract"]
        T41 --> T43
    end

    subgraph Phase5["Phase 5: Documentation and Operating Model"]
        T51["5.1 Wiki Architecture Docs"]
        T52["5.2 Project Skill and Progress Rules"]
        T53["5.3 Reporting and Migration Templates"]
        T51 --> T53
    end

    C3 --> T21
    C3 --> T32
    C2 --> T22
    C2 --> T31
    T23 --> T41
    T33 --> T42
    T43 --> T51
    C3 --> T52
```

## Lane Notes

| Phase | Parallel Lanes | Merge Risk |
|:------|:---------------|:-----------|
| Phase 2 | 2.1/2.3 in service lane, 2.2 in repository lane | Medium; both touch `server.py` during transition |
| Phase 3 | 3.1/3.3 in API/view lane, 3.2 in state lane | Medium; all call sites originate in `src/app.js` |
| Phase 4 | 4.1/4.3 in backend/release lane, 4.2 in frontend lane | Low after Phase 2/3 boundaries exist |
| Phase 5 | 5.1/5.3 in docs lane, 5.2 in process lane | Low |
