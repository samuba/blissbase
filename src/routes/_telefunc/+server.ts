import { telefunc } from 'telefunc'
import type { RequestHandler } from './$types'

const GET: RequestHandler = async (event) => {
    const response = await telefunc({
        url: event.request.url,
        method: event.request.method,
        body: await event.request.text(),
        context: {
            // Pass cookies context for server-side cookie handling
            cookies: event.cookies,
        },
    })
    return new Response(response.body, {
        headers: new Headers({ contentType: response.contentType }),
        status: response.statusCode,
    })
}

export { GET, GET as POST }