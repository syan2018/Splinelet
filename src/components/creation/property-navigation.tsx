'use client';
import { Fragment } from 'react';
import {
  Box,
  Layers,
  PaintBucket,
  Settings2,
  SlidersHorizontal,
  Download,
  Wrench,
} from 'lucide-react';

export const globalPropertyPages = ['project', 'palette', 'print', 'make'];

export default function PropertyNavigation({
  page,
  onPage,
  pathsSelected,
  hasSelection,
  canEditModifiers,
}: {
  page: string;
  onPage: (page: string) => void;
  pathsSelected: boolean;
  hasSelection: boolean;
  canEditModifiers: boolean;
}) {
  const groups = [
    {
      label: '工具',
      entries: [
        { id: 'tool', label: '工具', title: '当前工具设置', icon: Wrench },
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
    ...(hasSelection
      ? [
          {
            label: '选区',
            entries: [
              {
                id: pathsSelected ? 'lines' : 'object',
                label: '属性',
                title: '当前选区属性',
                icon: Box,
              },
              ...(canEditModifiers
                ? [
                    {
                      id: 'modifiers',
                      label: '构造',
                      title: '当前部件构造与修改器',
                      icon: SlidersHorizontal,
                    },
                  ]
                : []),
            ],
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
