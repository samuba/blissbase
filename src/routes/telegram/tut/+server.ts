import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
    console.log("get request");
    return new Response();
};