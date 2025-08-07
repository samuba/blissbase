import sharp from "sharp"; // blows bundle size by 15MB!!!!

export async function resizeCoverImage(input: sharp.SharpInput | Array<sharp.SharpInput>) {
    return await sharp(input)
        .resize(850, 850, {
            fit: 'inside',
            withoutEnlargement: true
        })
        .jpeg({ quality: 95 })
        .toBuffer();
}