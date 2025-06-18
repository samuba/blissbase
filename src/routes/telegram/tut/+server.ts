import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
    console.log("get request");
    return new Response();
};