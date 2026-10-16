import { useEffect, useRef } from "react";
import { MathfieldElement } from "mathlive";

MathfieldElement.fontsDirectory = "/fonts";
MathfieldElement.soundsDirectory = null;

function unstyledValue(field) {
  const value = field.getValue("latex-unstyled");
  if (field.value !== value) {
    const selection = field.selection;
    field.setValue(value, { silenceNotifications: true });
    field.selection = selection;
  }
  return value;
}

export default function FormulaField({ latex, disabled, onChange }) {
  const fieldRef = useRef(null);
  useEffect(() => {
    const field = fieldRef.current;
    if (field) field.menuItems = field.menuItems
      .filter(item => !["color", "foreground-color", "background-color"].includes(item.id))
      .map(item => item.submenu
        ? { ...item, submenu: item.submenu.filter(option => option.id !== "decoration-red-box") }
        : item);
  }, []);
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    if (field.value !== latex) field.value = latex;
    field.readOnly = disabled;
    const before = field.value;
    const plain = unstyledValue(field);
    if (plain !== before) onChange(plain);
  }, [latex, disabled, onChange]);
  return <math-field
    ref={fieldRef}
    aria-label="Editar fórmula matemática"
    onInput={(event) => onChange(unstyledValue(event.currentTarget))}
  />;
}

export function InlineMath({ latex }) {
  const fieldRef = useRef(null);
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    field.setValue(latex, { silenceNotifications: true });
    field.readOnly = true;
    field.tabIndex = -1;
  }, [latex]);
  return <math-field ref={fieldRef} read-only virtual-keyboard-mode="off" tabIndex={-1} aria-label={latex} />;
}
