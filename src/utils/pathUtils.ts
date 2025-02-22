function pathToPattern(routePath: string) {
  const params: string[] = [];

  // Transforme les paramètres dynamiques (ex: [model] devient :model)
  const pattern = routePath
    .replace(/\[(\w+)\]/g, (_, param) => {
      params.push(param);
      return "([^/]+)"; // Remplace les paramètres dynamiques par une expression régulière
    })
    .replace(/\./g, "\\.") // Échappe les points
    .replace(/\//g, "\\/"); // Échappe les slashes

  // Pour chaque route dynamique, on la formatte comme `models/:modelId`
  return { pattern: new RegExp(`^${pattern}$`), params };
}

export default pathToPattern;
