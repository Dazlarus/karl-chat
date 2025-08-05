const configUrl = "configs/static_settings.json";

async function loadConfig() {
  const res = await fetch(configUrl);
  const configJson = await res.json();
  return configJson;
}

export default loadConfig;
