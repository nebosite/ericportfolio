import { BRIGHT_COLORS, DARK_COLORS, PaletteColor } from "./palette";
import styles from "./HandsHighPage.module.css";

interface Props {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

/** Sixteen fixed swatches — a row of eight bright, a row of eight dark. */
export default function ColorSwatches({ label, value, onChange }: Props) {
  const swatch = (c: PaletteColor) => (
    <button
      key={c.hex}
      type="button"
      role="radio"
      aria-checked={c.hex === value}
      aria-label={c.name}
      title={c.name}
      className={styles.swatch}
      data-selected={c.hex === value}
      style={{ background: c.hex }}
      onClick={() => onChange(c.hex)}
    />
  );
  return (
    <div className={styles.control}>
      <span className={styles.label}>{label}</span>
      <div role="radiogroup" aria-label={label} className={styles.swatches}>
        {BRIGHT_COLORS.map(swatch)}
        {DARK_COLORS.map(swatch)}
      </div>
    </div>
  );
}
