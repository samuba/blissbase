import { getRequestEvent, query } from "$app/server";

export const getUserSession = query(async () => {
    const { supabase } = getRequestEvent().locals;
    const { data, error } = await supabase.auth.getClaims();
    if (error) throw error;
    return data?.claims as BlissabaseClaims;
});
