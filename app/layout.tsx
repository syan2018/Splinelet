import type { Metadata } from 'next';
import './globals.css';
import './creation.css';
export const metadata: Metadata = {
  title: 'Splinelet · 贝塞尔工作台',
  description:
    '在底图上点击锚点，沿边缘拟合可编辑的贝塞尔曲线，并导出用于建模的矢量路径。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
