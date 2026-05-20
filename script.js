const fileInput = document.getElementById('fileInput');
const selectButton = document.getElementById('selectButton');
const dropArea = document.getElementById('dropArea');
const fileList = document.getElementById('fileList');
const convertButton = document.getElementById('convertButton');

const widthInput = document.getElementById('width');
const heightInput = document.getElementById('height');
const formatInput = document.getElementById('format');
const qualityInput = document.getElementById('quality');
const qualityValue = document.getElementById('qualityValue');

let queue = [];

qualityInput.addEventListener('input', () => {
  qualityValue.innerText = qualityInput.value + '%';
});

selectButton.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
});

['dragenter','dragover'].forEach(eventName => {
  dropArea.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropArea.classList.add('dragover');
  });
});

['dragleave','drop'].forEach(eventName => {
  dropArea.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropArea.classList.remove('dragover');
  });
});

dropArea.addEventListener('drop', (e) => {
  handleFiles(e.dataTransfer.files);
});

async function handleFiles(files){

  for(const file of files){

    const item = {
      id: crypto.randomUUID(),
      file,
      status:'Aguardando'
    };

    queue.push(item);

    await renderCard(item);
  }
}

async function renderCard(item){

  const card = document.createElement('div');
  card.className = 'card';
  card.id = item.id;

  const preview = await createPreview(item.file);

  card.innerHTML = `
    <img src="${preview}">

    <strong>${item.file.name}</strong>

    <div>
      ${(item.file.size / 1024 / 1024).toFixed(2)} MB
    </div>

    <input
      type="text"
      value="${removeExtension(item.file.name)}"
      class="rename"
    >

    <div class="status">
      ${item.status}
    </div>

    <button class="remove">
      Remover
    </button>
  `;

  card.querySelector('.remove').addEventListener('click', () => {
    queue = queue.filter(q => q.id !== item.id);
    card.remove();
  });

  fileList.appendChild(card);
}

async function createPreview(file){

  let blob = file;

  if(file.name.toLowerCase().endsWith('.heic')){

    blob = await heic2any({
      blob:file,
      toType:'image/jpeg'
    });
  }

  return URL.createObjectURL(blob);
}

convertButton.addEventListener('click', async () => {

  if(!queue.length){
    alert('Adicione imagens.');
    return;
  }

  const processed = [];
  const zip = new JSZip();

  for(const item of queue){

    const card = document.getElementById(item.id);
    const status = card.querySelector('.status');
    const rename = card.querySelector('.rename').value;

    try{

      status.innerText = 'Convertendo';

      const blob = await processImage(item.file);

      const ext = formatInput.value === 'jpeg'
        ? 'jpg'
        : formatInput.value;

      const filename = rename + '.' + ext;

      processed.push({
        name:filename,
        blob
      });

      status.innerText = 'Concluído';

    }catch(error){

      console.error(error);
      status.innerText = 'Erro';
    }
  }

  if(processed.length === 1){

    downloadBlob(
      processed[0].blob,
      processed[0].name
    );

    return;
  }

  processed.forEach(file => {
    zip.file(file.name, file.blob);
  });

  const zipBlob = await zip.generateAsync({
    type:'blob'
  });

  downloadBlob(
    zipBlob,
    'imagens-convertidas.zip'
  );
});

async function processImage(file){

  let blob = file;

  if(file.name.toLowerCase().endsWith('.heic')){

    blob = await heic2any({
      blob:file,
      toType:'image/jpeg'
    });
  }

  const img = await loadImage(blob);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const width = parseInt(widthInput.value);
  const height = parseInt(heightInput.value);

  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,width,height);

  const scale = Math.min(
    width / img.width,
    height / img.height
  );

  const newWidth = img.width * scale;
  const newHeight = img.height * scale;

  const x = (width - newWidth) / 2;
  const y = (height - newHeight) / 2;

  ctx.drawImage(
    img,
    x,
    y,
    newWidth,
    newHeight
  );

  const mime = getMimeType(formatInput.value);

  return new Promise(resolve => {

    canvas.toBlob(
      resolve,
      mime,
      qualityInput.value / 100
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

function getMimeType(format){

  switch(format){

    case 'png':
      return 'image/png';

    case 'webp':
      return 'image/webp';

    default:
      return 'image/jpeg';
  }
}

function removeExtension(name){
  return name.replace(/\.[^/.]+$/, '');
}

function downloadBlob(blob, filename){

  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');

  a.href = url;
  a.download = filename;

  document.body.appendChild(a);

  a.click();

  a.remove();

  URL.revokeObjectURL(url);
}
