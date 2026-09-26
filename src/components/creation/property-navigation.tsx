'use client';
import { Fragment } from 'react';
import {
  Layers,
  PaintBucket,
  Settings2,
  Download,
  Wrench,
  SquareDashed,
} from 'lucide-react';
import type { PropertyContribution } from './properties/property-context';

export const globalPropertyPages = ['project', 'palette', 'print', 'make'];

export default function PropertyNavigation({
  page,
  onPage,
  contributions,
  transforming = false,
}: {
  page: string;
  onPage: (page: string) => void;
  contributions: readonly PropertyContribution[];
  transforming?: boolean;
}) {
  const groups = [
    {
      label: '工具',
      entries: [
        {
          id: 'tool',
          label: transforming ? '变换' : '工具',
          title: '当前工具设置',
          icon: transforming ? SquareDashed : Wrench,
        },
      ],
    },
    {
      label: '工程',
      entries: [
        {
          id: 'project',
          label: '设置',
          title: '工程设置 · 全局',
          icon: Settings2,
        },
        {
          id: 'palette',
          label: '色卡',
          title: '项目色卡 · 全局',
          icon: PaintBucket,
        },
        { id: 'print', label: '分层', title: '打印方案 · 全局', icon: Layers },
        {
          id: 'make',
          label: '导出',
          title: '检查与导出 · 全局',
          icon: Download,
        },
      ],
    },
    ...(contributions.length
      ? [
          {
            label: '选区',
            entries: contributions,
          },
        ]
      : []),
  ];
  return (
    <nav className="property-navigation" aria-label="属性分类">
      {groups.map((group, index) => (
        <Fragment key={group.label}>
          {index > 0 && <hr className="property-navigation-divider" />}
          <fieldset className="property-navigation-group">
            <legend>{group.label}</legend>
            {group.entries.map(({ id, label, title, icon: Icon }) => (
              <button
                key={id}
                title={title}
                aria-label={title}
                aria-pressed={page === id}
                onClick={() => onPage(id)}
              >
                <Icon size={18} />
                <small>{label}</small>
              </button>
            ))}
          </fieldset>
        </Fragment>
      ))}
    </nav>
  );
}
