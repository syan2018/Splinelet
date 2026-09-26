import type {
  StudioImportIssue,
  StudioImportReport,
  StudioRegionMigrationReport,
} from '@/lib/editor/studio-display-types';

const visibleIssue = (issue: StudioImportIssue) =>
  issue.severity === 'warning' || issue.severity === 'error';

const referenceName = (ref: StudioImportIssue['ref']) => {
  if (typeof ref === 'string') return ref;
  if (!ref) return null;
  return ref.name || ref.id || null;
};

const migrationSummary = (report: StudioImportReport | null | undefined) => {
  const directMigration: StudioRegionMigrationReport | undefined =
    report &&
    (report.kind === 'region-definitions' || report.kind === 'native') &&
    typeof report.regions === 'number'
      ? {
          kind: report.kind,
          regions: report.regions,
          ...(typeof report.verifiedOutputs === 'number'
            ? { verifiedOutputs: report.verifiedOutputs }
            : {}),
        }
      : undefined;
  const migration = report?.regionMigration || directMigration;
  if (!migration || migration.kind === 'native') return null;
  return `已转换 ${migration.regions} 个区域声明，并验证 ${migration.verifiedOutputs ?? 0} 个输出`;
};

export function StudioImportNotice({
  report,
}: {
  report: StudioImportReport | null | undefined;
}) {
  const issues = report?.issues?.filter(visibleIssue) || [];
  const conversion = migrationSummary(report);
  if (!issues.length && !conversion) return null;
  return (
    <section
      className="creation-warning"
      aria-label="工程迁移注意事项"
      style={{
        maxHeight: '30vh',
        overflow: 'auto',
        flexShrink: 0,
        overflowWrap: 'anywhere',
      }}
    >
      <details>
        <summary>
          {issues.length
            ? `检测到 ${issues.length} 项迁移注意事项`
            : '工程已转换为 V5 声明式区域'}
        </summary>
        {conversion && <p>{conversion}</p>}
        {issues.map((issue, index) => {
          const reference = referenceName(issue.ref);
          return (
            <p key={`${issue.code}:${index}`}>
              <strong>{issue.code}</strong>：{issue.message}
              {reference && <span>{`（受影响对象：${reference}）`}</span>}
            </p>
          );
        })}
      </details>
    </section>
  );
}
