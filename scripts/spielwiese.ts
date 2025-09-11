import * as cloudinary from '../src/lib/cloudinary';

const id = "https://sei.jetzt/storage/2172/01JWQ3AZJ8PBVCTTQ8QTVPSM8R.png"

const cloudinaryImgUrl = `https://res.cloudinary.com/${cloudinary.loadCreds().cloudName}/image/upload/v1757526879/${id}`

console.log("cloudinaryImgUrl", cloudinaryImgUrl);
const response = await fetch(cloudinaryImgUrl);
console.log("image size", (await response.bytes()).length);

const res = await cloudinary.getImageData([id], cloudinary.loadCreds());
// const res = await cloudinary.deleteImages(["id"], cloudinary.loadCreds());
console.log(JSON.stringify(res, null, 2));


