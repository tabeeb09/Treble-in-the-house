function renderTemplate(template, bindings = {}) {
  if (template == null) {
    return null;
  }

  return String(template).replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_, key) => {
    const value = bindings[key];
    return value == null ? "" : String(value);
  });
}

function renderOutputTemplate(template, values = {}) {
  if (template == null) {
    return "";
  }

  return String(template).replace(/\{\s*([^{}\s]+)\s*\}/g, (_, key) => {
    const value = values[key];
    return value == null ? "" : String(value);
  });
}

module.exports = {
  renderTemplate,
  renderOutputTemplate
};
