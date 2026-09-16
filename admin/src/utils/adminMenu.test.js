// Lo que ve en el menú el admin de un comercio, y lo que ve el dueño.
//
// ANTES DE ESTO HABÍA UN ERROR DE CADA LADO
//
// Las tres pantallas de plataforma cruzan TODOS los comercios y el gate real
// es server-side (requirePlatformOwner, allowlist de email). En el menú, sin
// embargo, quedaban así:
//
//   plataforma/margen    escondida de TODOS, incluido el dueño
//   plataforma/gasto-ia  escondida de TODOS, incluido el dueño
//   plataforma/precios   visible para TODOS los admins  ← 403 para un comercio
//
// Las dos primeras solo se alcanzaban tipeando la URL; la tercera quedaba
// como ruta huérfana y la verificación de cobertura la agregaba sola al final
// del menú, o sea que el admin de cualquier comercio veía un ítem a un
// reporte de precios de plataforma.
//
// Ahora las tres viven en un grupo propio marcado ownerOnly, y MainLayout lo
// filtra con el isPlatformOwner que informa el backend.

// adminMenu importa routesConfig, que arrastra las páginas y con ellas
// config/env.js, que aborta sin esto. Va antes del import del módulo.
process.env.REACT_APP_API_BASE_URL = "http://localhost:5000/api";

const { adminMenuItems } = await import("./adminMenu");

const PLATAFORMA = ["plataforma/gasto-ia", "plataforma/margen", "plataforma/precios"];

/** El filtro que aplica MainLayout antes de dibujar. */
const menuPara = user =>
  adminMenuItems.filter(item => !item.ownerOnly || user?.isPlatformOwner);

const clavesDe = items =>
  items.flatMap(item => (item.children ? item.children.map(c => c.key) : [item.key]));

describe("el grupo Plataforma", () => {
  test("existe, está marcado ownerOnly y tiene las tres pantallas", () => {
    const grupo = adminMenuItems.find(item => item.key === "plataforma");

    expect(grupo).toBeDefined();
    expect(grupo.ownerOnly).toBe(true);
    expect(grupo.children.map(c => c.key).sort()).toEqual([...PLATAFORMA].sort());
  });

  test("es el ÚNICO grupo restringido: el resto del menú no cambia", () => {
    // Si un día alguien marca ownerOnly de más, medio panel desaparece para
    // todos los comercios y se nota tarde.
    const restringidos = adminMenuItems.filter(item => item.ownerOnly);

    expect(restringidos.map(g => g.key)).toEqual(["plataforma"]);
  });
});

describe("qué ve cada uno", () => {
  test("el admin de un comercio NO ve ninguna de las tres", () => {
    const claves = clavesDe(menuPara({ isPlatformOwner: false }));

    for (const clave of PLATAFORMA) {
      expect(claves).not.toContain(clave);
    }
  });

  test("el dueño de la plataforma ve las tres", () => {
    const claves = clavesDe(menuPara({ isPlatformOwner: true }));

    for (const clave of PLATAFORMA) {
      expect(claves).toContain(clave);
    }
  });

  test("sin el dato, se asume que NO es dueño", () => {
    // Un panel desplegado antes que el backend, o un usuario viejo en el
    // store persistido, no traen isPlatformOwner. Ante la duda el ítem no se
    // dibuja: el costo de ocultarlo es un clic menos; el de mostrarlo, un
    // 403 en la cara de un comercio.
    for (const user of [undefined, null, {}, { isPlatformOwner: undefined }]) {
      const claves = clavesDe(menuPara(user));
      expect(claves).not.toContain("plataforma/gasto-ia");
    }
  });

  test("el comercio sigue viendo su propio menú completo", () => {
    // La red de seguridad del cambio: filtrar de más rompería el panel entero
    // y este test lo dice antes que el usuario.
    const comercio = clavesDe(menuPara({ isPlatformOwner: false }));
    const duenio = clavesDe(menuPara({ isPlatformOwner: true }));

    expect(comercio.length).toBe(duenio.length - PLATAFORMA.length);
    expect(comercio.length).toBeGreaterThan(15);
    expect(comercio).toContain("");
    expect(comercio).toContain("productlist");
  });
});

describe("cobertura de rutas", () => {
  test("ninguna de las tres quedó como ruta huérfana al final del menú", () => {
    // Así es como precios terminaba visible para todos: sin lugar en
    // MENU_STRUCTURE ni en HIDDEN_ROUTES, el menú la agregaba sola con una
    // etiqueta derivada de la ruta.
    const sueltas = adminMenuItems.filter(
      item => !item.children && PLATAFORMA.includes(item.key),
    );

    expect(sueltas).toEqual([]);
  });
});
