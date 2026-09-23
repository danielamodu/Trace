/**
 * TRACE — Runtime validation for the Investigation contract (Phase 3C).
 *
 * `validateInvestigation` checks the full domain case; `validateContract`
 * checks the envelope and its consistency (caseId match, recomputed
 * completeness, recomputed evidence counts). Both return ordered error lists
 * (empty = valid) so route handlers can surface every problem at once;
 * `assertContract` throws `ContractError` for build-time enforcement.
 *
 * Non-negotiables enforced here:
 *  - HYPOTHESIS provenance anywhere → error (kept out of the default contract).
 *  - Interpretive entity roles (attacker/beneficiary/liquidity-source/sink) → error.
 *  - Dangling references (participants, relationshipIds, evidenceEventIds,
 *    sourceEventIds) → error. DERIVED groups must stay expandable.
 *  - Completeness must equal the recomputed rule outcome (fixture-cache can
 *    never validate as complete).
 */

import type { Investigation } from '../types/investigation.ts';
import { collectOrigins, computeCompleteness, countEvidence } from './completeness.ts';
import { CONTRACT_VERSION } from './types.ts';
import type { CoverageReport, DataSource, InvestigationContract } from './types.ts';

export class ContractError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`invalid contract: ${errors.length} error(s): ${errors.slice(0, 3).join(' | ')}`);
    this.name = 'ContractError';
    this.errors = errors;
  }
}

const EVENT_TYPES = new Set([
  'funding', 'transfer', 'swap', 'contract-interaction',
  'capital-consolidation', 'capital-dispersal', 'entity-relationship',
]);
const ADMISSION_RULES = new Set([
  'value-threshold', 'nansen-relation', 'method-of-interest',
  'burn-sink', 'below-threshold', 'derived-grouping',
]);
const ENTITY_ROLES = new Set(['subject', 'funder', 'counterparty']);
const REL_KINDS = new Set(['transfer', 'swap', 'funder', 'counterparty', 'related-wallet', 'flow']);
const PARTICIPANT_SIDES = new Set(['from', 'to', 'actor', 'counterparty']);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isValidIso(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v));
}

function checkProvenance(
  p: unknown,
  path: string,
  errors: string[],
  opts: { allowDerived: boolean; allowEmptySources?: boolean; allowEmptySourceEventIds?: boolean },
): void {
  if (!isObject(p)) {
    errors.push(`${path}.provenance must be an object`);
    return;
  }
  const kind = (p as { kind?: unknown }).kind;
  if (kind === 'HYPOTHESIS') {
    errors.push(`${path}.provenance must not be HYPOTHESIS in the default contract`);
    return;
  }
  if (kind === 'FACT' || kind === 'RELATION') {
    const sources = (p as { sources?: unknown }).sources;
    // allowEmptySources is reserved for the authored case-subject entity, which
    // is case input rather than Nansen evidence (its statement must say so).
    if (!Array.isArray(sources) || (sources.length === 0 && opts.allowEmptySources !== true)) {
      errors.push(`${path}.provenance.sources must list at least one source`);
      return;
    }
    if (typeof (p as { statement?: unknown }).statement !== 'string' || ((p as { statement?: string }).statement as string).length === 0) {
      errors.push(`${path}.provenance.statement is required`);
    }
    sources.forEach((s, i) => {
      if (!isObject(s)) {
        errors.push(`${path}.provenance.sources[${i}] must be an object`);
        return;
      }
      if (typeof s.source !== 'string' || s.source.length === 0) {
        errors.push(`${path}.provenance.sources[${i}].source is required`);
      }
      if (!isValidIso(s.capturedAt)) {
        errors.push(`${path}.provenance.sources[${i}].capturedAt must be ISO-8601`);
      }
    });
    return;
  }
  if (kind === 'DERIVED') {
    if (!opts.allowDerived) {
      errors.push(`${path}.provenance must not be DERIVED here`);
      return;
    }
    const d = p as { sourceEventIds?: unknown; calculation?: unknown; inputs?: unknown };
    // allowEmptySourceEventIds is reserved for case-level summary roll-ups
    // (e.g. entity counts, which aggregate entities rather than events). The
    // reproducibility anchor is inputs.engine + the named calculation.
    if (
      !Array.isArray(d.sourceEventIds) ||
      (d.sourceEventIds.length === 0 && opts.allowEmptySourceEventIds !== true)
    ) {
      errors.push(`${path}.provenance.sourceEventIds must list at least one event (DERIVED stays expandable)`);
    }
    if (Array.isArray(d.sourceEventIds) && d.sourceEventIds.length === 0 && opts.allowEmptySourceEventIds === true) {
      const inputs = d.inputs as { engine?: unknown } | undefined;
      if (typeof inputs?.engine !== 'string' || inputs.engine.length === 0) {
        errors.push(`${path}.provenance.inputs.engine must anchor event-less DERIVED roll-ups`);
      }
    }
    if (typeof d.calculation !== 'string' || d.calculation.length === 0) {
      errors.push(`${path}.provenance.calculation must name the derivation`);
    }
    return;
  }
  errors.push(`${path}.provenance.kind must be FACT|RELATION|DERIVED, got ${JSON.stringify(kind)}`);
}

export function validateInvestigation(inv: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(inv)) return ['investigation must be an object'];
  const v = inv as Record<string, unknown>;

  if (typeof v.id !== 'string' || v.id.length === 0) errors.push('id must be a non-empty string');
  if (typeof v.name !== 'string' || v.name.length === 0) errors.push('name must be a non-empty string');
  if (typeof v.chain !== 'string' || v.chain.length === 0) errors.push('chain must be a non-empty string');
  if (typeof v.headline !== 'string' || v.headline.length === 0) errors.push('headline must be a non-empty string');
  if (!['reconstructed', 'partial', 'error'].includes(v.status as string)) {
    errors.push(`status must be reconstructed|partial|error, got ${JSON.stringify(v.status)}`);
  }
  if (!isObject(v.window) || !isValidIso((v.window as Record<string, unknown>).from) || !isValidIso((v.window as Record<string, unknown>).to)) {
    errors.push('window.from/window.to must be ISO-8601 timestamps');
  } else if (Date.parse((v.window as { from: string }).from) > Date.parse((v.window as { to: string }).to)) {
    errors.push('window.from must not be after window.to');
  }
  if (!isValidIso(v.reconstructedAt)) errors.push('reconstructedAt must be ISO-8601');

  // Summary: FACT/DERIVED only.
  if (!Array.isArray(v.summary)) {
    errors.push('summary must be an array');
  } else {
    const keys = new Set<string>();
    v.summary.forEach((m, i) => {
      if (!isObject(m)) {
        errors.push(`summary[${i}] must be an object`);
        return;
      }
      if (typeof m.key !== 'string' || m.key.length === 0) errors.push(`summary[${i}].key is required`);
      else if (keys.has(m.key)) errors.push(`summary[${i}].key '${m.key}' is duplicated`);
      else keys.add(m.key);
      if (typeof m.label !== 'string' || m.label.length === 0) errors.push(`summary[${i}].label is required`);
      if (typeof m.value !== 'number' && typeof m.value !== 'string') {
        errors.push(`summary[${i}].value must be a number|string`);
      }
      checkProvenance(m.provenance, `summary[${i}]`, errors, { allowDerived: true, allowEmptySourceEventIds: true });
      if (isObject(m.provenance) && (m.provenance as { kind?: unknown }).kind === 'HYPOTHESIS') {
        // checkProvenance already reported; nothing extra.
      }
    });
  }

  const events = Array.isArray(v.events) ? v.events : null;
  const entities = Array.isArray(v.entities) ? v.entities : null;
  const relationships = Array.isArray(v.relationships) ? v.relationships : null;
  if (events === null) errors.push('events must be an array');
  if (entities === null) errors.push('entities must be an array');
  if (relationships === null) errors.push('relationships must be an array');

  const eventIds = new Set<string>();
  if (events !== null) {
    events.forEach((e, i) => {
      const path = `events[${i}]`;
      if (!isObject(e)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (typeof e.id !== 'string' || !/^event_\d+$/.test(e.id)) {
        errors.push(`${path}.id must match event_###, got ${JSON.stringify(e.id)}`);
      } else if (eventIds.has(e.id)) {
        errors.push(`${path}.id '${e.id}' is duplicated`);
      } else {
        eventIds.add(e.id);
      }
      if (e.order !== i + 1) errors.push(`${path}.order must be ${i + 1} (sequential in timeline order)`);
      if (!isValidIso(e.timestamp)) errors.push(`${path}.timestamp must be ISO-8601`);
      if (!EVENT_TYPES.has(e.type as string)) errors.push(`${path}.type is unknown: ${JSON.stringify(e.type)}`);
      if (typeof e.title !== 'string' || e.title.length === 0) errors.push(`${path}.title is required`);
      if (!ADMISSION_RULES.has(e.admissionRule as string)) {
        errors.push(`${path}.admissionRule is unknown: ${JSON.stringify(e.admissionRule)}`);
      }
      if (typeof e.primary !== 'boolean') errors.push(`${path}.primary must be boolean`);
      if (typeof e.significance !== 'number' || !Number.isFinite(e.significance)) {
        errors.push(`${path}.significance must be a finite number`);
      }
      if (e.txHash !== undefined && (typeof e.txHash !== 'string' || !/^0x[0-9a-fA-F]+$/.test(e.txHash))) {
        errors.push(`${path}.txHash must be hex, got ${JSON.stringify(e.txHash)}`);
      }
      if (e.method !== undefined && typeof e.method !== 'string') errors.push(`${path}.method must be a string`);
      if (!Array.isArray(e.participants) || e.participants.length === 0) {
        errors.push(`${path}.participants must list at least one participant`);
      } else {
        e.participants.forEach((p: unknown, j: number) => {
          if (!isObject(p) || typeof p.entityId !== 'string') {
            errors.push(`${path}.participants[${j}].entityId is required`);
          }
          if (!isObject(p) || !PARTICIPANT_SIDES.has((p as { side?: unknown }).side as string)) {
            errors.push(`${path}.participants[${j}].side is unknown`);
          }
        });
      }
      if (e.value !== undefined) {
        if (!isObject(e.value) || typeof (e.value as { valueUsd?: unknown }).valueUsd !== 'number' || !Number.isFinite((e.value as { valueUsd?: number }).valueUsd as number)) {
          errors.push(`${path}.value.valueUsd must be a finite number when present`);
        }
      }
      if (!Array.isArray(e.relationshipIds)) errors.push(`${path}.relationshipIds must be an array`);
      checkProvenance(e.provenance, path, errors, { allowDerived: true });
      if (Array.isArray((e.provenance as { sourceEventIds?: unknown })?.sourceEventIds)) {
        for (const id of ((e.provenance as unknown as { sourceEventIds: unknown[] }).sourceEventIds)) {
          if (typeof id !== 'string' || !eventIds.has(id)) {
            // Forward references allowed within the same events array: collect
            // ids first would be stricter; instead accept any event_### id here
            // and verify global resolvability in the cross-reference pass below.
            if (typeof id !== 'string' || !/^event_\d+$/.test(id)) {
              errors.push(`${path}.provenance.sourceEventIds must be event ids, got ${JSON.stringify(id)}`);
            }
          }
        }
      }
    });
  }

  const entityIds = new Set<string>();
  let subjectCount = 0;
  if (entities !== null) {
    entities.forEach((en, i) => {
      const path = `entities[${i}]`;
      if (!isObject(en)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (typeof en.id !== 'string' || !/^entity_/.test(en.id)) {
        errors.push(`${path}.id must start with entity_, got ${JSON.stringify(en.id)}`);
      } else if (entityIds.has(en.id)) {
        errors.push(`${path}.id '${en.id}' is duplicated`);
      } else {
        entityIds.add(en.id);
      }
      if (!ENTITY_ROLES.has(en.role as string)) {
        errors.push(`${path}.role must be subject|funder|counterparty (descriptive only), got ${JSON.stringify(en.role)}`);
      }
      if (en.role === 'subject') subjectCount += 1;
      if (typeof en.admissionReason !== 'string' || en.admissionReason.length === 0) {
        errors.push(`${path}.admissionReason is required`);
      }
      if (typeof en.chain !== 'string' || en.chain.length === 0) errors.push(`${path}.chain is required`);
      if (typeof en.displayName !== 'string' || en.displayName.length === 0) {
        errors.push(`${path}.displayName is required`);
      }
      if (!Array.isArray(en.labels)) {
        errors.push(`${path}.labels must be an array`);
      } else {
        en.labels.forEach((l: unknown, j: number) => {
          if (!isObject(l) || typeof l.label !== 'string' || l.label.length === 0) {
            errors.push(`${path}.labels[${j}].label is required`);
          }
          checkProvenance((l as Record<string, unknown>)?.provenance, `${path}.labels[${j}]`, errors, { allowDerived: false });
        });
      }
      checkProvenance(en.provenance, path, errors, { allowDerived: true, allowEmptySources: en.role === 'subject' });
    });
    if (entities.length > 0 && subjectCount !== 1) {
      errors.push(`entities must contain exactly one subject, found ${subjectCount}`);
    }
  }

  const relIds = new Set<string>();
  if (relationships !== null) {
    relationships.forEach((r, i) => {
      const path = `relationships[${i}]`;
      if (!isObject(r)) {
        errors.push(`${path} must be an object`);
        return;
      }
      if (typeof r.id !== 'string' || !/^rel_\d+$/.test(r.id)) {
        errors.push(`${path}.id must match rel_###, got ${JSON.stringify(r.id)}`);
      } else if (relIds.has(r.id)) {
        errors.push(`${path}.id '${r.id}' is duplicated`);
      } else {
        relIds.add(r.id);
      }
      if (!REL_KINDS.has(r.kind as string)) errors.push(`${path}.kind is unknown: ${JSON.stringify(r.kind)}`);
      if (typeof r.fromEntityId !== 'string' || !entityIds.has(r.fromEntityId)) {
        errors.push(`${path}.fromEntityId dangles: ${JSON.stringify(r.fromEntityId)}`);
      }
      if (typeof r.toEntityId !== 'string' || !entityIds.has(r.toEntityId)) {
        errors.push(`${path}.toEntityId dangles: ${JSON.stringify(r.toEntityId)}`);
      }
      if (typeof r.directed !== 'boolean') errors.push(`${path}.directed must be boolean`);
      if (r.metrics !== undefined) {
        if (!isObject(r.metrics)) {
          errors.push(`${path}.metrics must be an object`);
        } else {
          for (const [k, num] of Object.entries(r.metrics)) {
            if (typeof num !== 'number' || !Number.isFinite(num)) {
              errors.push(`${path}.metrics.${k} must be a finite number`);
            }
          }
        }
      }
      if (!Array.isArray(r.evidenceEventIds)) {
        errors.push(`${path}.evidenceEventIds must be an array`);
      } else {
        for (const id of r.evidenceEventIds) {
          if (typeof id !== 'string' || !eventIds.has(id as string)) {
            errors.push(`${path}.evidenceEventIds dangles: ${JSON.stringify(id)}`);
          }
        }
      }
      checkProvenance(r.provenance, path, errors, { allowDerived: true });
    });
  }

  // Cross-reference pass: every participant / relationshipId / sourceEventId resolves.
  if (events !== null && entities !== null && relationships !== null) {
    events.forEach((e, i) => {
      if (!isObject(e)) return;
      for (const p of ((e as { participants?: unknown }).participants as Array<{ entityId?: unknown }> ?? [])) {
        if (typeof p?.entityId === 'string' && !entityIds.has(p.entityId)) {
          errors.push(`events[${i}].participants entityId dangles: ${JSON.stringify(p.entityId)}`);
        }
      }
      for (const id of ((e as { relationshipIds?: unknown }).relationshipIds as unknown[] ?? [])) {
        if (typeof id !== 'string' || !relIds.has(id)) {
          errors.push(`events[${i}].relationshipIds dangles: ${JSON.stringify(id)}`);
        }
      }
      const prov = (e as { provenance?: unknown }).provenance as { sourceEventIds?: unknown } | undefined;
      if (isObject(prov) && Array.isArray(prov.sourceEventIds)) {
        for (const id of prov.sourceEventIds) {
          if (typeof id !== 'string' || !eventIds.has(id)) {
            errors.push(`events[${i}].provenance.sourceEventIds dangles: ${JSON.stringify(id)}`);
          }
        }
      }
    });
    relationships.forEach((r, i) => {
      if (!isObject(r)) return;
      const prov = (r as { provenance?: unknown }).provenance as { sourceEventIds?: unknown } | undefined;
      if (isObject(prov) && Array.isArray(prov.sourceEventIds)) {
        for (const id of prov.sourceEventIds) {
          if (typeof id !== 'string' || !eventIds.has(id)) {
            errors.push(`relationships[${i}].provenance.sourceEventIds dangles: ${JSON.stringify(id)}`);
          }
        }
      }
    });
  }

  if (!Array.isArray(v.dataGaps)) {
    errors.push('dataGaps must be an array');
  } else {
    v.dataGaps.forEach((g, i) => {
      if (typeof g !== 'string' || g.length === 0) errors.push(`dataGaps[${i}] must be a non-empty string`);
    });
  }
  if (!Array.isArray(v.sources)) {
    errors.push('sources must be an array');
  } else {
    v.sources.forEach((s, i) => {
      if (!isObject(s) || typeof s.source !== 'string' || s.source.length === 0) {
        errors.push(`sources[${i}].source is required`);
      }
      if (!isObject(s) || !isValidIso((s as { capturedAt?: unknown }).capturedAt)) {
        errors.push(`sources[${i}].capturedAt must be ISO-8601`);
      }
    });
  }
  return errors;
}

export function validateContract(c: unknown): string[] {
  const errors: string[] = [];
  if (!isObject(c)) return ['contract must be an object'];
  const v = c as Record<string, unknown>;
  if (v.contractVersion !== CONTRACT_VERSION) {
    errors.push(`contractVersion must be '${CONTRACT_VERSION}', got ${JSON.stringify(v.contractVersion)}`);
  }
  if (typeof v.engineVersion !== 'string' || v.engineVersion.length === 0) {
    errors.push('engineVersion is required');
  }
  if (!['fixture-cache', 'live-nansen'].includes(v.dataSource as string)) {
    errors.push(`dataSource must be fixture-cache|live-nansen, got ${JSON.stringify(v.dataSource)}`);
  }
  // Phase 3H: optional pool enumeration. Absent = pre-3H contract (still
  // valid). Present = sorted-unique valid values; non-empty must include the
  // conservative single dataSource; must equal the recomputed enumeration.
  if (v.dataSources !== undefined) {
    const ds = v.dataSources;
    if (!Array.isArray(ds) || ds.some((d) => d !== 'fixture-cache' && d !== 'live-nansen')) {
      errors.push('dataSources must be an array of fixture-cache|live-nansen when present');
    } else {
      const sorted = [...new Set(ds)].sort();
      if (JSON.stringify(ds) !== JSON.stringify(sorted)) {
        errors.push('dataSources must be sorted unique when present');
      }
      if (sorted.length > 0 && !sorted.includes(v.dataSource as string)) {
        errors.push(`dataSources ${JSON.stringify(sorted)} must include dataSource '${v.dataSource}'`);
      }
      if (isObject(v.investigation)) {
        const expected = collectOrigins(v.investigation as unknown as Investigation);
        if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
          errors.push(`dataSources ${JSON.stringify(sorted)} do not match the recomputed pool enumeration ${JSON.stringify(expected)}`);
        }
      }
    }
  }
  if (!['complete', 'incomplete'].includes(v.completeness as string)) {
    errors.push(`completeness must be complete|incomplete, got ${JSON.stringify(v.completeness)}`);
  }
  if (!Array.isArray(v.completenessReasons)) {
    errors.push('completenessReasons must be an array');
  } else if (v.completeness === 'incomplete' && v.completenessReasons.length === 0) {
    errors.push('incomplete completeness requires at least one reason');
  }
  if (!isObject(v.coverage)) {
    errors.push('coverage must be an object');
  } else {
    const flags = (v.coverage as { flags?: unknown }).flags;
    for (const f of ['fundingEvidence', 'counterpartyAggregates', 'transactionWindowCovered']) {
      if (typeof (flags as Record<string, unknown> | undefined)?.[f] !== 'boolean') {
        errors.push(`coverage.flags.${f} must be boolean`);
      }
    }
    if (!Array.isArray((v.coverage as { reasons?: unknown }).reasons)) {
      errors.push('coverage.reasons must be an array');
    }
  }
  if (!isObject(v.evidence)) {
    errors.push('evidence must be an object');
  } else {
    const ev = v.evidence as Record<string, unknown>;
    for (const f of [
      'observedFacts', 'observedRelations', 'derivedValues', 'derivedGroupings',
      'derivedFlowEdges', 'primaryEvents', 'collapsedEvents', 'duplicatesSkipped',
      'flowsSkipped', 'eventsMissingUsd',
    ]) {
      if (typeof ev[f] !== 'number' || !Number.isInteger(ev[f] as number) || (ev[f] as number) < 0) {
        errors.push(`evidence.${f} must be a non-negative integer`);
      }
    }
    if (!Array.isArray(ev.unavailableFields) || (ev.unavailableFields as unknown[]).some((f) => typeof f !== 'string')) {
      errors.push('evidence.unavailableFields must be a string array');
    }
    if (!Array.isArray(ev.limitations) || (ev.limitations as unknown[]).length === 0) {
      errors.push('evidence.limitations must list at least one limitation');
    }
  }

  const invErrors = validateInvestigation(v.investigation);
  for (const e of invErrors) errors.push(`investigation.${e}`);

  // Consistency: caseId, recomputed completeness, recomputed evidence counts.
  if (isObject(v.investigation) && typeof (v.investigation as { id?: unknown }).id === 'string') {
    if (v.caseId !== (v.investigation as { id: string }).id) {
      errors.push(`caseId '${v.caseId}' must equal investigation.id`);
    }
  } else {
    errors.push('caseId consistency cannot be checked without investigation.id');
  }
  if (isObject(v.investigation) && isObject(v.coverage) && (v.dataSource === 'fixture-cache' || v.dataSource === 'live-nansen')) {
    const expected = computeCompleteness(
      v.investigation as unknown as Investigation,
      v.coverage as unknown as CoverageReport,
      v.dataSource as DataSource,
    );
    if (expected.completeness !== v.completeness) {
      errors.push(
        `completeness '${v.completeness}' contradicts the recomputed rule outcome '${expected.completeness}' (fixture-cache can never be complete)`,
      );
    } else if (JSON.stringify([...expected.completenessReasons].sort()) !== JSON.stringify([...(v.completenessReasons as string[])].sort())) {
      errors.push('completenessReasons do not match the recomputed rule outcome');
    }
    if (isObject(v.evidence) && invErrors.length === 0) {
      const counts = countEvidence(v.investigation as unknown as Investigation);
      const ev = v.evidence as Record<string, unknown>;
      for (const [k, num] of Object.entries(counts)) {
        if (ev[k] !== num) {
          errors.push(`evidence.${k} is ${JSON.stringify(ev[k])} but the investigation recomputes to ${num}`);
        }
      }
    }
  }
  return errors;
}

/** Build-time enforcement: throws ContractError listing every problem. */
export function assertContract(c: unknown): asserts c is InvestigationContract {
  const errors = validateContract(c);
  if (errors.length > 0) throw new ContractError(errors);
}
