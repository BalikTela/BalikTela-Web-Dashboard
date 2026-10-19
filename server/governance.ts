import { hasPermission } from './access-control.js';
import type { ConfigurationRecord, UserRecord } from './types.js';

export function buildGovernance(actor: UserRecord, configuration: ConfigurationRecord | null) {
  const aggregateOnly = actor.role === 'Government' || actor.scope.aggregateOnly;
  return {
    methodology: {
      massAccounting: 'Confirmed recovery share = validated final reuse and recycling output linked to collected batches / validated collection in the same registration cohort. Transfers and stage weights are not additive.',
      environmentalImpact: 'CO2e, water savings and landfill avoidance are not calculated without an approved methodology. Hub disposal is reported separately from recovered output.',
      predictiveAnalytics: 'Bundled synthetic training data; chronological holdout evaluation and regional history gates. Forecasts are estimates, not measured operational outcomes.',
      version: configuration?.methodologyVersion ?? 'Not approved',
    },
    privacy: { role: actor.role, aggregateOnly, exportAllowed: hasPermission(actor, 'reports.export'), policy: aggregateOnly ? 'Aggregate/de-identified access' : actor.role === 'Administrator' ? 'Authorized system administration' : 'Authorized regional, organization or individual scope' },
    policyIndicators: [
      { label: 'Collection and recovery evidence', status: 'Available', caveat: 'Validated intake and final output are separate. Missing evidence is not an observed zero; the reporting window selects batch registration.' },
      { label: 'Hub disposal oversight', status: 'Monitoring', caveat: 'Approved Hub operators perform disposal through mobile. Web monitors operator, listing, weight, reason and time. A disposal record alone does not prove landfill avoidance.' },
      { label: 'Data quality', status: 'Available', caveat: 'Rule-based findings use scoped batch, listing, transfer, measurement and recovery records; they are not an independent accuracy certification.' },
      { label: 'EPR reporting support', status: 'Preparation only', caveat: 'Requires approved definitions, reporting boundaries and review. No statutory compliance certification is issued by this dashboard.' },
      { label: 'Environmental equivalents', status: 'Disabled', caveat: 'No approved conversion factors, counterfactual landfill baseline or final-destination verification.' },
    ],
  };
}
