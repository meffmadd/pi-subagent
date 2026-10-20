---
name: simplification-review
description: Rank superfluous abstractions, mechanisms, and optional features. Use when assessing overengineering or asking what can be removed to reach a simpler implementation.
---

# Simplification review

Produce evidence-backed simplification options. Review only unless implementation is requested.

## Vocabulary

**Module**: anything with an interface and an implementation — a function, class, package, or tier-spanning slice. _Avoid_: unit, component, service.

**Interface**: everything a caller must know to use the module correctly: the type signature, but also invariants, ordering constraints, error modes, required configuration, and performance characteristics.

**Leverage**: what callers get from a module. More capability per unit of interface they learn.

**Locality**: what maintainers get from a module. Change, bugs, knowledge, and verification concentrate in one place rather than spreading across callers. Fix once, fixed everywhere.

**Shallow module**: large interface, thin implementation — the opposite of a module that earns its keep.

**The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.

**Pass-through**: an interface that adds nothing — callers could reach the behaviour directly.

## Process

1. **Scope.** State the core behaviour and guarantees to preserve from the request and relevant specifications. Treat simplicity claims and line budgets as hypotheses to investigate.

2. **Trace.** Follow the actual workflow from inputs through execution to outputs. Inspect callers, configuration, and tests for each candidate. Search for unused interfaces, pass-throughs, duplicated state or work, lifecycle constraints, speculative extensibility, compatibility scaffolding, and tests pinning implementation details. Record what each mechanism currently enables or protects; qualify uncertain dynamic or external usage.

3. **Challenge.** Apply the deletion test to every candidate. Prefer changes that remove concepts and caller obligations while retaining leverage and locality. Separate:
   - **Refactor:** behaviour preserved.
   - **Interface change:** callers or saved data must change.
   - **Feature cut:** a capability disappears.
   - **Guarantee reduction:** safety, correctness, or operational protection weakens.

   Mark conflicts with documented requirements. When a feature's value depends on actual use, make the recommendation conditional. Judge dispensability by present needs and obligations, not implementation length; useful abstractions may be worth keeping.

4. **Rank.** Return a concise list in decreasing superfluousness, not estimated line savings. Each item includes a file/symbol reference, concrete evidence, why the mechanism is dispensable, the smallest replacement, and its change category or categories. Label speculative findings explicitly; report only supported candidates rather than filling a quota.

Close with what earns its keep and the smallest plausible remaining workflow. Qualify size estimates by their scope and retained guarantees.
