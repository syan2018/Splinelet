'use client';
import { useRef, useState } from 'react';
import { readSlicerTemplate } from '@/lib/bambu-3mf.mjs';
type Template = ReturnType<typeof readSlicerTemplate>;

export default function SlicerTemplate({
  value,
  onChange,
  disabled = false,
}: {
  value: Template;
  onChange: (value: Template) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  return (
    <details className="creation-advanced" open={value ? undefined : true}>
      <summary>
        3MF 切片配置
        {value
          ? ` · ${value.settings.printer_model || value.name}`
          : ' · 尚未设置'}
      </summary>
      <p>
        {value
          ? `${value.settings.printer_settings_id} · ${value.settings.filament_settings_id[0]}`
          : '选择一个由 Bambu Studio 保存的工程 3MF，读取打印机、工艺和耗材配置。设置随描线工程保存，后续导出可直接复用。'}
      </p>
      <button disabled={disabled} onClick={() => input.current?.click()}>
        {value ? '更换配置模板' : '载入 Bambu 配置模板'}
      </button>
      {value && (
        <button
          disabled={disabled}
          onClick={() => {
            onChange(null);
            setError('');
          }}
        >
          移除模板
        </button>
      )}
      <input
        ref={input}
        hidden
        type="file"
        accept=".3mf"
        aria-label="Bambu 配置模板"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const template = readSlicerTemplate(
              await file.arrayBuffer(),
              file.name,
            );
            onChange(template);
            setError('');
          } catch (e) {
            setError(e instanceof Error ? e.message : '模板读取失败');
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
      <small>
        保留模板的机器参数；工程启用打印分层时同步层高和首层层高。新增色号沿用模板首个耗材参数，实际
        AMS 槽位在切片软件中选择。
      </small>
    </details>
  );
}

