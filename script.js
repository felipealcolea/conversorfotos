"use strict";

const els = {
  fileInput: document.getElementById("fileInput"),
  list: document.getElementById("list"),
  convertBtn: document.getElementById("convertBtn"),
  clearBtn: document.getElementById("clearBtn"),
  dropArea: document.getElementById("dropArea"),
  width: document.getElementById("width"),
  height: document.getElementById("height"),
  format: document.getElementById("format"),
  transparentCopy: document.getElementById("transparentCopy"),
  fileCount: document.getElementById("fileCount"),
  readyCount: document.getElementById("readyCount"),
  globalStatus: document.getElementById("globalStatus"),
  progressBar: document.getElementById("progressBar")
};

const ACCEPTED_EXTENSIONS = new Set(["jpg","jpeg","png","webp","heic","heif"]);
const ACCEPTED_MIME = new Set(["image/jpeg","image/png","image/webp","image/heic","image/heif"]);
const MAX_DIMENSION = 8000;
const TRANSFORMERS_CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
const BACKGROUND_REMOVAL_MODELS = [
  "briaai/RMBG-1.4",
  "onnx-community/MVANet-ONNX"
];

let queue = [];
let isConverting = false;
let backgroundRemoverPromise = null;
let backgroundRemoverModel = "";

els.fileInput.addEventListener("change", event => {
  addFiles(event.target.files);
  event.target.value = "";
});

["dragenter","dragover"].forEach(type => {
  els.dropArea.addEventListener(type, event => {
    event.preventDefault();
    els.dropArea.classList.add("drag");
  });
});

["dragleave","drop"].forEach(type => {
  els.dropArea.addEventListener(type, event => {
    event.preventDefault();
    els.dropArea.classList.remove("drag");
  });
});

els.dropArea.addEventListener("drop", event => addFiles(event.dataTransfer.files));
els.convertBtn.addEventListener("click", convertQueue);
els.clearBtn.addEventListener("click", clearQueue);

async function addFiles(fileList){
  const files = Array.from(fileList || []);
  if(!files.length || isConverting) return;

  const fragment = document.createDocumentFragment();
  const newItems = files.map(createQueueItem);

  newItems.forEach(item => {
    queue.push(item);
    fragment.appendChild(createCard(item));
  });

  els.list.appendChild(fragment);
  updateSummary();

  for(const item of newItems){
    await preparePreview(item);
    await nextFrame();
  }
}

function createQueueItem(file){
  return {
    id: globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
    file,
    card: null,
    previewUrl: null,
    sourceBlob: null,
    status: "pending",
    error: ""
  };
}

function createCard(item){
  const card = document.createElement("article");
  card.className = "card";
  card.dataset.id = item.id;
  item.card = card;

  const preview = document.createElement("div");
  preview.className = "preview";

  const removeBtn = document.createElement("button");
  removeBtn.className = "removeBtn";
  removeBtn.type = "button";
  removeBtn.textContent = "X";
  removeBtn.title = "Remover imagem";
  removeBtn.setAttribute("aria-label", `Remover ${item.file.name}`);
  removeBtn.addEventListener("click", () => removeItem(item.id));

  const fallback = document.createElement("span");
  fallback.className = "previewFallback";
  fallback.textContent = "Preparando preview...";
  preview.appendChild(fallback);

  const body = document.createElement("div");
  body.className = "cardBody";

  const name = document.createElement("p");
  name.className = "fileName";
  name.title = item.file.name;
  name.textContent = item.file.name;

  const meta = document.createElement("p");
  meta.className = "meta";

  const size = document.createElement("span");
  size.textContent = formatBytes(item.file.size);

  const dimensions = document.createElement("span");
  dimensions.className = "dimensions";
  dimensions.textContent = "Aguardando";

  meta.append(size, dimensions);

  const rename = document.createElement("input");
  rename.className = "rename";
  rename.type = "text";
  rename.value = removeExt(item.file.name);
  rename.maxLength = 120;
  rename.setAttribute("aria-label", `Renomear ${item.file.name}`);

  const status = document.createElement("p");
  status.className = "status";
  status.textContent = "Aguardando";

  body.append(name, meta, rename, status);
  card.append(removeBtn, preview, body);
  return card;
}

async function preparePreview(item){
  const status = getStatus(item);
  const preview = item.card.querySelector(".preview");
  const dimensions = item.card.querySelector(".dimensions");

  try{
    validateFile(item.file);
    setStatus(item, "busy", "Lendo arquivo");

    const blob = await getSourceBlob(item);
    const image = await loadImage(blob);

    dimensions.textContent = `${image.naturalWidth} x ${image.naturalHeight}`;
    releaseImage(image);

    item.previewUrl = URL.createObjectURL(blob);
    preview.replaceChildren(createPreviewImage(item.previewUrl, item.file.name));
    setStatus(item, "ready", "Pronto");
  }catch(error){
    item.status = "error";
    item.error = friendlyError(error, item.file);
    preview.replaceChildren(createPreviewFallback("Preview indisponivel"));
    status.title = item.error;
    setStatus(item, "error", item.error);
  }finally{
    updateSummary();
  }
}

async function convertQueue(){
  if(isConverting) return;

  const dimensions = getTargetDimensions();
  if(!dimensions){
    setGlobalStatus("Informe largura e altura validas entre 1 e 8000 pixels.");
    return;
  }

  const activeItems = queue.filter(item => item.status === "ready");
  if(!activeItems.length){
    setGlobalStatus(queue.length ? "Nenhum arquivo valido para converter." : "Adicione imagens para comecar.");
    return;
  }

  if(typeof JSZip !== "function"){
    setGlobalStatus("Geracao de ZIP indisponivel. Verifique a conexao com a CDN do JSZip.");
    return;
  }

  isConverting = true;
  toggleControls(false);
  updateProgress(0);
  setGlobalStatus("Convertendo imagens...");

  const zip = new JSZip();
  const usedNames = new Set();
  let success = 0;
  let generatedFiles = 0;

  for(let index = 0; index < activeItems.length; index++){
    const item = activeItems[index];

    try{
      setStatus(item, "busy", "Convertendo");
      const outputs = await convertImage(item, dimensions, els.transparentCopy.checked, progress => {
        const base = (index / activeItems.length) * 85;
        const slice = 85 / activeItems.length;
        updateProgress(base + (slice * progress));
      });
      const baseName = getDesiredName(item);

      outputs.forEach(output => {
        const filename = uniqueFileName(baseName, output.ext, usedNames);
        zip.file(filename, output.blob);
        generatedFiles++;
      });

      success++;
      if(outputs.aiFailed){
        setStatus(item, "warn", "PNG IA falhou; formato principal ok");
        item.status = "ready";
      }else{
        setStatus(item, "ready", outputs.length > 1 ? "Concluido - 2 arquivos" : "Concluido");
      }
    }catch(error){
      item.error = friendlyError(error, item.file);
      setStatus(item, "error", item.error);
    }

    updateProgress(((index + 1) / activeItems.length) * 85);
    updateSummary();
    await nextFrame();
  }

  if(!success){
    setGlobalStatus("Nenhuma imagem foi convertida. Confira os erros na fila.");
    updateProgress(0);
    isConverting = false;
    toggleControls(true);
    return;
  }

  try{
    setGlobalStatus("Gerando arquivo ZIP...");
    const zipBlob = await zip.generateAsync(
      { type:"blob", compression:"DEFLATE", compressionOptions:{ level:6 } },
      metadata => updateProgress(85 + (metadata.percent * 0.15))
    );

    downloadBlob(zipBlob, "imagens-convertidas-fbf.zip");
    updateProgress(100);
    setGlobalStatus(`${success} imagem${success === 1 ? "" : "s"} processada${success === 1 ? "" : "s"} e ${generatedFiles} arquivo${generatedFiles === 1 ? "" : "s"} gerado${generatedFiles === 1 ? "" : "s"}.`);
  }catch(error){
    console.error(error);
    setGlobalStatus("Nao foi possivel gerar o ZIP. Tente novamente com menos arquivos por lote.");
  }finally{
    isConverting = false;
    toggleControls(true);
  }
}

async function convertImage(item, dimensions, includeTransparentCopy, onProgress){
  const blob = await getSourceBlob(item);
  const image = await loadImage(blob);
  const outputs = [];
  const fit = getContainRect(image.naturalWidth, image.naturalHeight, dimensions.width, dimensions.height);

  try{
    const isJpeg = els.format.value === "jpeg";
    const standardCanvas = renderImageToCanvas(image, dimensions, fit, isJpeg ? "#ffffff" : null);
    outputs.push({
      blob: await canvasToBlob(standardCanvas, `image/${els.format.value}`, isJpeg ? 0.9 : 0.92),
      ext: getOutputExtension(),
    });
    disposeCanvas(standardCanvas);

    if(includeTransparentCopy && getOutputExtension() !== "png"){
      let cutoutImage = null;
      let transparentCanvas = null;

      try{
        setStatus(item, "busy", "Removendo fundo...");
        const cutoutBlob = await removeBackgroundWithAi(blob, item, onProgress);
        cutoutImage = await loadImage(cutoutBlob);
        const cutoutFit = getContainRect(cutoutImage.naturalWidth, cutoutImage.naturalHeight, dimensions.width, dimensions.height);
        transparentCanvas = renderImageToCanvas(cutoutImage, dimensions, cutoutFit, null);
        outputs.push({
          blob: await canvasToBlob(transparentCanvas, "image/png", 0.92),
          ext: "png",
        });
      }catch(error){
        console.warn(error);
        outputs.aiFailed = true;
      }finally{
        if(cutoutImage) releaseImage(cutoutImage);
        if(transparentCanvas) disposeCanvas(transparentCanvas);
      }
    }
  }finally{
    releaseImage(image);
  }

  return outputs;
}

function renderImageToCanvas(image, dimensions, fit, fillStyle){
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha:fillStyle === null });

  if(!ctx){
    throw new Error("canvas");
  }

  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if(fillStyle){
    ctx.fillStyle = fillStyle;
    ctx.fillRect(0,0,canvas.width,canvas.height);
  }

  ctx.drawImage(image, fit.x, fit.y, fit.width, fit.height);
  return canvas;
}

async function removeBackgroundWithAi(blob, item, onProgress){
  setStatus(item, "busy", backgroundRemoverPromise ? "Removendo fundo..." : "Carregando IA...");
  onProgress?.(0.05);

  const remover = await getBackgroundRemover(progress => {
    onProgress?.(Math.min(0.35, progress * 0.35));
  });

  const url = URL.createObjectURL(blob);

  try{
    setStatus(item, "busy", "Removendo fundo...");
    onProgress?.(0.45);

    const output = await remover(url);
    const rawImage = Array.isArray(output) ? output[0] : output;

    if(!rawImage || typeof rawImage.toBlob !== "function"){
      throw new Error("background-removal");
    }

    const result = await rawImage.toBlob();
    if(!result){
      throw new Error("background-removal");
    }

    onProgress?.(0.95);
    return result;
  }finally{
    URL.revokeObjectURL(url);
  }
}

async function getBackgroundRemover(onModelProgress){
  if(backgroundRemoverPromise) return backgroundRemoverPromise;

  backgroundRemoverPromise = (async () => {
    const transformers = await import(TRANSFORMERS_CDN);
    const { pipeline, env } = transformers;

    env.allowLocalModels = false;
    env.allowRemoteModels = true;

    let lastError = null;

    for(const model of BACKGROUND_REMOVAL_MODELS){
      try{
        const remover = await createBackgroundPipeline(pipeline, model, "webgpu", onModelProgress);
        backgroundRemoverModel = model;
        return remover;
      }catch(error){
        lastError = error;
      }

      try{
        const remover = await createBackgroundPipeline(pipeline, model, null, onModelProgress);
        backgroundRemoverModel = model;
        return remover;
      }catch(error){
        lastError = error;
      }
    }

    throw lastError || new Error("background-removal");
  })();

  try{
    return await backgroundRemoverPromise;
  }catch(error){
    backgroundRemoverPromise = null;
    throw error;
  }
}

function createBackgroundPipeline(pipeline, model, device, onModelProgress){
  const options = {
    progress_callback: data => {
      if(typeof data.progress === "number"){
        onModelProgress?.(Math.max(0, Math.min(1, data.progress / 100)));
      }
    }
  };

  if(device){
    options.device = device;
  }

  return pipeline("background-removal", model, options);
}

async function getSourceBlob(item){
  if(item.sourceBlob) return item.sourceBlob;

  if(isHeic(item.file)){
    if(typeof heic2any !== "function"){
      throw new Error("heic-library");
    }

    const converted = await heic2any({
      blob:item.file,
      toType:"image/jpeg",
      quality:0.92
    });

    item.sourceBlob = Array.isArray(converted) ? converted[0] : converted;
    if(!item.sourceBlob) throw new Error("heic");
    return item.sourceBlob;
  }

  item.sourceBlob = item.file;
  return item.sourceBlob;
}

function loadImage(blob){
  return new Promise((resolve,reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image-load"));
    };

    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality){
  return new Promise((resolve,reject) => {
    try{
      canvas.toBlob(blob => {
        if(blob) resolve(blob);
        else reject(new Error("canvas-export"));
      }, type, quality);
    }catch(error){
      reject(error);
    }
  });
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function disposeCanvas(canvas){
  canvas.width = 0;
  canvas.height = 0;
}

function clearQueue(){
  if(isConverting) return;
  queue.forEach(releaseItem);
  queue = [];
  els.list.replaceChildren();
  updateProgress(0);
  setGlobalStatus("Nenhuma imagem adicionada.");
  updateSummary();
}

function removeItem(id){
  if(isConverting) return;

  const index = queue.findIndex(item => item.id === id);
  if(index === -1) return;

  const [item] = queue.splice(index,1);
  releaseItem(item);
  item.card.remove();

  if(queue.length === 0){
    updateProgress(0);
    setGlobalStatus("Nenhuma imagem adicionada.");
  }

  updateSummary();
}

function releaseItem(item){
  if(item.previewUrl){
    URL.revokeObjectURL(item.previewUrl);
    item.previewUrl = null;
  }
}

function validateFile(file){
  const ext = getExtension(file.name);
  const mimeOk = !file.type || ACCEPTED_MIME.has(file.type);
  if(!ACCEPTED_EXTENSIONS.has(ext) || !mimeOk){
    throw new Error("invalid-file");
  }
  if(file.size === 0){
    throw new Error("empty-file");
  }
}

function getTargetDimensions(){
  const width = Number.parseInt(els.width.value, 10);
  const height = Number.parseInt(els.height.value, 10);
  if(!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if(width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
  return { width, height };
}

function getContainRect(sourceWidth, sourceHeight, targetWidth, targetHeight){
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);
  return {
    width,
    height,
    x:Math.round((targetWidth - width) / 2),
    y:Math.round((targetHeight - height) / 2)
  };
}

function setStatus(item, type, text){
  item.status = type;
  const status = getStatus(item);
  status.className = `status ${type}`;
  status.textContent = text;
  status.title = text;
}

function getStatus(item){
  return item.card.querySelector(".status");
}

function updateSummary(){
  const total = queue.length;
  const ready = queue.filter(item => item.status === "ready").length;
  const errors = queue.filter(item => item.status === "error").length;

  els.fileCount.textContent = `${total} arquivo${total === 1 ? "" : "s"}`;
  els.readyCount.textContent = `${ready} pronto${ready === 1 ? "" : "s"}`;
  const waiting = queue.some(item => item.status === "pending" || item.status === "busy");

  els.convertBtn.disabled = total === 0 || isConverting || ready === 0 || waiting;
  els.clearBtn.disabled = total === 0 || isConverting;

  if(!total) return;
  if(errors){
    setGlobalStatus(`${ready} pronto${ready === 1 ? "" : "s"} e ${errors} com erro.`);
  }else{
    setGlobalStatus(`${ready} de ${total} imagem${total === 1 ? "" : "s"} pronta${ready === 1 ? "" : "s"} para conversao.`);
  }
}

function toggleControls(enabled){
  els.fileInput.disabled = !enabled;
  els.clearBtn.disabled = !enabled || queue.length === 0;
  els.convertBtn.disabled = !enabled || queue.filter(item => item.status === "ready").length === 0;
  els.width.disabled = !enabled;
  els.height.disabled = !enabled;
  els.format.disabled = !enabled;
  els.transparentCopy.disabled = !enabled;
  els.list.querySelectorAll(".removeBtn").forEach(button => {
    button.disabled = !enabled;
  });
}

function updateProgress(value){
  els.progressBar.style.width = `${Math.max(0,Math.min(100,value))}%`;
}

function setGlobalStatus(text){
  els.globalStatus.textContent = text;
}

function createPreviewImage(url, alt){
  const image = document.createElement("img");
  image.src = url;
  image.alt = `Preview de ${alt}`;
  image.loading = "lazy";
  image.decoding = "async";
  return image;
}

function createPreviewFallback(text){
  const span = document.createElement("span");
  span.className = "previewFallback";
  span.textContent = text;
  return span;
}

function getDesiredName(item){
  const input = item.card.querySelector(".rename");
  return sanitizeName(input.value) || removeExt(item.file.name) || "imagem";
}

function uniqueFileName(base, ext, usedNames){
  const cleanBase = sanitizeName(base) || "imagem";
  let filename = `${cleanBase}.${ext}`;
  let counter = 2;

  while(usedNames.has(filename.toLowerCase())){
    filename = `${cleanBase}-${counter}.${ext}`;
    counter++;
  }

  usedNames.add(filename.toLowerCase());
  return filename;
}

function sanitizeName(name){
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g,"-")
    .replace(/\s+/g," ")
    .replace(/\.+$/,"")
    .slice(0,120);
}

function getOutputExtension(){
  return els.format.value === "jpeg" ? "jpg" : els.format.value;
}

function getExtension(name){
  return String(name).split(".").pop().toLowerCase();
}

function isHeic(file){
  const ext = getExtension(file.name);
  return ext === "heic" || ext === "heif" || file.type === "image/heic" || file.type === "image/heif";
}

function removeExt(name){
  return String(name).replace(/\.[^/.]+$/,"");
}

function formatBytes(bytes){
  if(!bytes) return "0 KB";
  const units = ["B","KB","MB","GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024,index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function friendlyError(error, file){
  const message = error && error.message ? error.message : "";

  if(message === "invalid-file") return "Arquivo invalido ou formato nao suportado.";
  if(message === "empty-file") return "Arquivo vazio ou corrompido.";
  if(message === "heic-library") return "Conversao HEIC indisponivel. Verifique a conexao com a CDN.";
  if(message === "heic") return "Nao foi possivel converter este HEIC.";
  if(message === "image-load") return "Erro ao carregar a imagem.";
  if(message === "canvas") return "Canvas indisponivel neste navegador.";
  if(message === "canvas-export") return "Erro ao exportar a imagem no formato escolhido.";
  if(message === "background-removal") return "Nao foi possivel remover o fundo com IA neste arquivo.";
  if(isHeic(file)) return "HEIC corrompido ou incompatibilidade de leitura.";
  return "Falha na conversao deste arquivo.";
}

function releaseImage(image){
  image.onload = null;
  image.onerror = null;
  image.src = "";
}

function nextFrame(){
  return new Promise(resolve => requestAnimationFrame(resolve));
}
