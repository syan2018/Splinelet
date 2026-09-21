'use client';

import { Menu } from '@base-ui/react/menu';
import { ChevronDown, Spline } from 'lucide-react';

export default function StudioFileMenu({
  fileBusy,
  busy,
  onOpen,
  onNewFromImage,
  onImportVector,
  onSave,
  onSaveAs,
  onHelp,
  onExample,
  onApi,
}: {
  fileBusy: boolean;
  busy: boolean;
  onOpen: () => void;
  onNewFromImage: () => void;
  onImportVector: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onHelp: () => void;
  onExample: () => void;
  onApi: () => void;
}) {
  const menus = [
    {
      label: '文件',
      items: [
        { label: '打开工程…', action: onOpen, disabled: busy || fileBusy },
        {
          label: '从图片新建工程…',
          action: onNewFromImage,
          disabled: busy || fileBusy,
        },
        {
          label: '导入 SVG／笔迹…',
          action: onImportVector,
          disabled: busy || fileBusy,
        },
        {
          label: '保存',
          action: onSave,
          shortcut: 'Ctrl+S',
          disabled: fileBusy,
        },
        {
          label: '另存为…',
          action: onSaveAs,
          shortcut: 'Ctrl+Shift+S',
          disabled: fileBusy,
        },
      ],
    },
    {
      label: '帮助',
      items: [
        { label: '操作帮助', action: onHelp },
        {
          label: '载入示例工程',
          action: onExample,
          disabled: busy || fileBusy,
        },
        { label: 'Agent API', action: onApi },
      ],
    },
  ];
  return (
    <Menu.Root>
      <Menu.Trigger className="studio-brand-menu" aria-label="Splinelet 主菜单">
        <Spline size={23} />
        <span>Splinelet</span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={8}
          align="start"
          className="studio-menu-positioner"
        >
          <Menu.Popup className="studio-menu-popup">
            {menus.map(({ label, items }) => (
              <Menu.Group key={label}>
                <Menu.GroupLabel className="studio-menu-group-label">
                  {label}
                </Menu.GroupLabel>
                {items.map((item) => (
                  <Menu.Item
                    key={item.label}
                    className="studio-menu-item"
                    onClick={item.action}
                    disabled={item.disabled}
                  >
                    <span>{item.label}</span>
                    {'shortcut' in item && <kbd>{item.shortcut}</kbd>}
                  </Menu.Item>
                ))}
              </Menu.Group>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
