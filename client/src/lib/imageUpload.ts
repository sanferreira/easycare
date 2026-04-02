type ImageCompressionOptions = {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  outputType?: "image/webp" | "image/jpeg" | "image/png";
};

const DEFAULT_OPTIONS: Required<ImageCompressionOptions> = {
  maxWidth: 640,
  maxHeight: 640,
  quality: 0.82,
  outputType: "image/webp",
};

const MAX_IMAGE_PAYLOAD_LENGTH = 900_000;

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo da imagem."));
    reader.readAsDataURL(file);
  });

const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel processar a imagem selecionada."));
    image.src = src;
  });

export async function imageFileToDataUrl(
  file: File,
  options?: ImageCompressionOptions,
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Selecione um arquivo de imagem valido.");
  }

  const finalOptions = { ...DEFAULT_OPTIONS, ...options };
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);

  const widthRatio = finalOptions.maxWidth / image.width;
  const heightRatio = finalOptions.maxHeight / image.height;
  const ratio = Math.min(1, widthRatio, heightRatio);

  const targetWidth = Math.max(1, Math.round(image.width * ratio));
  const targetHeight = Math.max(1, Math.round(image.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Nao foi possivel processar a imagem.");

  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  let compressed = canvas.toDataURL(finalOptions.outputType, finalOptions.quality);
  if (compressed.length > MAX_IMAGE_PAYLOAD_LENGTH) {
    compressed = canvas.toDataURL("image/jpeg", 0.72);
  }

  if (compressed.length > MAX_IMAGE_PAYLOAD_LENGTH) {
    throw new Error("Imagem muito grande. Use uma imagem menor.");
  }

  return compressed;
}
