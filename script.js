const fileInput = document.getElementById("fileInput");
const list = document.getElementById("list");
const convertBtn = document.getElementById("convertBtn");
const dropArea = document.getElementById("dropArea");

const widthInput = document.getElementById("width");
const heightInput = document.getElementById("height");
const formatInput = document.getElementById("format");

let queue = [];

fileInput.addEventListener("change", (e) => {
  addFiles(e.target.files);
});

dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropArea.classList.add("drag");
});

dropArea.addEventListener("dragleave", () => {
  dropArea.classList.remove("drag");
});

dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.classList.remove("drag");

  addFiles(e.dataTransfer.files);
});

async function addFiles(files){

  for(const file of files){

    const id = Date.now() + Math.random();

    const item = {
      id:id,
      file:file
    };

    queue.push(item);

    await renderItem(item);
  }
}

async function renderItem(item){

  let blob = item.file;

  if(item.file.name.toLowerCase().endsWith(".heic")){

    blob = await heic2any({
      blob:item.file,
      toType:"image/jpeg"
    });
  }

  const url = URL.createObjectURL(blob);

  const div = document.createElement("div");

  div.className = "card";
  div.id = item.id;

  div.innerHTML = `
    <img src="${url}">

    <p><strong>${item.file.name}</strong></p>

    <input
      class="rename"
      value="${removeExt(item.file.name)}"
    >

    <p class="status">Aguardando</p>
  `;

  list.appendChild(div);
}

convertBtn.addEventListener("click", async () => {

  if(queue.length === 0){
    alert("Adicione imagens.");
    return;
  }

  const zip = new JSZip();
  let total = 0;

  for(const item of queue){

    const card = document.getElementById(item.id);
    const status = card.querySelector(".status");
    const rename = card.querySelector(".rename").value;

    status.innerText = "Convertendo...";

    try{

      const blob = await convertImage(item.file);

      const ext = formatInput.value === "jpeg"
        ? "jpg"
        : formatInput.value;

      zip.file(rename + "." + ext, blob);

      status.innerText = "Concluído";

      total++;

    }catch(e){

      console.error(e);

      status.innerText = "Erro";
    }
  }

  if(total === 0){
    alert("Nenhuma imagem convertida.");
    return;
  }

  const content = await zip.generateAsync({
    type:"blob"
  });

  const a = document.createElement("a");

  a.href = URL.createObjectURL(content);
  a.download = "imagens-convertidas.zip";

  a.click();
});

async function convertImage(file){

  let blob = file;

  if(file.name.toLowerCase().endsWith(".heic")){

    blob = await heic2any({
      blob:file,
      toType:"image/jpeg"
    });
  }

  const img = await loadImage(blob);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const width = parseInt(widthInput.value);
  const height = parseInt(heightInput.value);

  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,width,height);

  const scale = Math.min(
    width / img.width,
    height / img.height
  );

  const w = img.width * scale;
  const h = img.height * scale;

  const x = (width - w) / 2;
  const y = (height - h) / 2;

  ctx.drawImage(img,x,y,w,h);

  return new Promise((resolve) => {

    canvas.toBlob(
      resolve,
      "image/" + formatInput.value,
      0.9
    );

  });
}

function loadImage(blob){

  return new Promise((resolve,reject) => {

    const img = new Image();

    img.onload = () => resolve(img);
    img.onerror = reject;

    img.src = URL.createObjectURL(blob);
  });
}

function removeExt(name){
  return name.replace(/\.[^/.]+$/, "");
}
