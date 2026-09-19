'use client';

export default function CreationIssue({
  name,
  message,
  pending,
  pathNames,
  onLocate,
  onDisable,
  onRetry,
  busy,
}: {
  name: string;
  message: string;
  pending?: boolean;
  pathNames: string[];
  onLocate: () => void;
  onDisable?: () => void;
  onRetry?: () => void;
  busy: boolean;
}) {
  const numerical =
    /non-noded|TopologyException|side location conflict|found null|NaN/i.test(
      message,
    );
  return (
    <section role="alert" className="creation-warning creation-issue">
      <b>
        {name} · {pending ? '这次用途切换未应用' : '构面需要检查'}
      </b>
      <p>
        {numerical ? '重合交点的计算没有完成。' : `${message}。`}
        {pending
          ? '原来的区域和颜色保持不变。'
          : '无效区域已停止显示；源线、颜色和高度记录仍在工程中。'}
      </p>
      {!!pathNames.length && <small>检查线条：{pathNames.join('、')}</small>}
      <div className="creation-connection-actions">
        {!!pathNames.length && (
          <button disabled={busy} onClick={onLocate}>
            定位分区线
          </button>
        )}
        {onDisable && (
          <button disabled={busy} onClick={onDisable}>
            暂不参与分区
          </button>
        )}
        {onRetry && (
          <button disabled={busy} onClick={onRetry}>
            重新计算
          </button>
        )}
      </div>
      <details>
        <summary>计算详情</summary>
        <p>{message}</p>
      </details>
    </section>
  );
}
