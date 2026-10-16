export const MESAS = Object.freeze([
  { code: "AG", name: "Agrícola" },
  { code: "PE", name: "Pecuaria" },
  { code: "FO", name: "Forestal" },
  { code: "MA", name: "Medio ambiente" },
  { code: "AE", name: "Agroecosistemas" },
  { code: "AI", name: "Agroindustrias" },
]);

export const MESA_CODES = MESAS.map((mesa) => mesa.code);
export const mesaName = (code) => MESAS.find((mesa) => mesa.code === code)?.name || null;
