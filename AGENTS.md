You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

## Runtime
This project uses bun for dependency management and task/script running.
Node is used in dev and prod as runtime.

## Svelte
Always use class based stores for reactivity and state management instead of functions with getters/setters.

## DB
Assume drizzle is being used for all database operations and schemas.
Never run "drizzle push" command yourself.

## Sveltekit
Prefer remote functions when calling server.
Always use `src/libs/routes.ts` when referencing routes. 

## UI & CSS
Assume Tailwind use.
Use Bits-UI for component primitives.
Use Daisy UI

## Scraping
Always assume the scripts are running in bun runtime
Make sure a error when processing or parsing a item can never stop the whole script
One `scrape-{site_name}.ts` file for each website were scraping
Scrape scripts should have a function for every field in the event object. Like `getName`, `getDescription`, `getTags` etc.
Each scrape script should get the entire html and pass it down to the individual field functions, e.g. `getName(html)`, `getTags(html)`

## Typescript
Always use early returns, early continues and early breaks. 
Always use backticks for strings except for: imports, nested strings, console.log, console.error.
Always use string interpolation when possible instead of concatenating strings. Do this: `${foo} ${bar}` Instead of this: foo + " " + bar
Always use an object named 'args' instead of individual arguments for functions when the function exceeds 2 arguments
Always place type definitions at the bottom of the file unless the type is only used inside a function/context then leave it there.  
Never type a variable if typescript can infer the type correctly on its own.
Always check if an array is defined and has values like this: `arr?.length` not `arr && arr.length > 0`
Always create short, descriptive doc comments for function that include at least one example.