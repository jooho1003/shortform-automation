export type DetailDesign = {
  revision: number;
  font: 'sans' | 'serif' | 'mono';
  headingFont: 'sans' | 'serif' | 'mono';
  colors: {background: string; text: string; accent: string; muted: string};
  texts: Record<string, string>;
  textStyles?: Record<string, {font?: 'sans' | 'serif' | 'mono'; color?: string; size?: number}>;
  images: Record<string, {x: number; y: number; scale: number}>;
};

export const DESIGN_FONTS: Record<DetailDesign['font'], string> = {
  sans: "'Pretendard', 'Malgun Gothic', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', 'Batang', serif",
  mono: "'Cascadia Code', Consolas, monospace",
};

export function defaultDetailDesign(): DetailDesign {
  return {
    revision: 0,
    font: 'sans',
    headingFont: 'serif',
    colors: {background: '#f5f1e8', text: '#16332b', accent: '#18372f', muted: '#587066'},
    texts: {}, textStyles: {},
    images: {},
  };
}
