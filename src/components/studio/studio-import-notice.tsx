import type {
  StudioImportIssue,
  StudioImportReport,
} from '@/lib/editor/studio-display-types';

const visibleIssue = (issue: StudioImportIssue) =>
  issue.severity === 'warning' || issue.severity === 'error';

const referenceName = (ref: StudioImportIssue['ref']) => {
  if (typeof ref === 'string') return ref;
  if (!ref) return null;
  return ref.name || ref.id || null;
};

export function StudioImportNotice({
  report,
}: {
  report: StudioImportReport | null | undefined;
}) {
  const issues = report?.issues.filter(visibleIssue) || [];
  if (!issues.length) return null;
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
        <summary>{`检测到 ${issues.length} 项迁移注意事项`}</summary>
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
