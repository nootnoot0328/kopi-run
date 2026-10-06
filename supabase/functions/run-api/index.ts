import { createClient } from 'npm:@supabase/supabase-js@2'

type Json = Record<string, unknown>

const allowedOrigins = new Set(
  (Deno.env.get('KOPI_RUN_ALLOWED_ORIGINS') ||
    'https://nootnoot0328.github.io,http://localhost:8000,http://127.0.0.1:8000')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
)

function cors(req: Request) {
  const origin = req.headers.get('origin') || ''
  const allowOrigin = allowedOrigins.has(origin) ? origin : 'https://nootnoot0328.github.io'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function fail(req: Request, status: number, error: string) {
  return json(req, { error }, status)
}

function randomToken(bytes: number) {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  let binary = ''
  for (const b of data) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function cleanText(value: unknown, max: number) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/\s+/g, ' ').slice(0, max)
}

function getAdminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  const legacyServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url) throw new Error('SUPABASE_URL is missing')

  let key = legacyServiceRole || ''
  if (!key && secretKeys) {
    const parsed = JSON.parse(secretKeys)
    key = parsed.default || Object.values(parsed)[0] || ''
  }
  if (!key) throw new Error('Supabase server secret is missing')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function loadRun(supabase: ReturnType<typeof getAdminClient>, token: string) {
  const { data, error } = await supabase
    .from('runs')
    .select('id, share_token, runner_key_hash, group_name, status, closes_at, created_at')
    .eq('share_token', token)
    .maybeSingle()

  if (error) throw error
  return data
}

function isExpired(run: { closes_at?: string | null }) {
  return Boolean(run.closes_at && new Date(run.closes_at).getTime() <= Date.now())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(req) })
  }

  try {
    const supabase = getAdminClient()

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const token = cleanText(url.searchParams.get('token'), 80)
      const runnerKey = cleanText(url.searchParams.get('runner_key'), 160)

      if (!token) return fail(req, 400, 'Run token is required.')

      const run = await loadRun(supabase, token)
      if (!run) return fail(req, 404, 'This Kopi Run could not be found.')

      const response: Json = {
        run: {
          token: run.share_token,
          group_name: run.group_name,
          status: run.status,
          closes_at: run.closes_at,
          created_at: run.created_at,
        },
      }

      if (runnerKey && (await sha256(runnerKey)) === run.runner_key_hash) {
        const { data: orders, error } = await supabase
          .from('orders')
          .select('id, display_name, drink, created_at, updated_at')
          .eq('run_id', run.id)
          .order('created_at', { ascending: true })

        if (error) throw error
        response.orders = orders || []
        response.runner = true
      }

      return json(req, response)
    }

    if (req.method !== 'POST') {
      return fail(req, 405, 'Method not allowed.')
    }

    let body: Json
    try {
      body = await req.json()
    } catch {
      return fail(req, 400, 'Invalid JSON body.')
    }

    const action = cleanText(body.action, 40)

    if (action === 'create_run') {
      const groupName = cleanText(body.group_name, 80) || null
      const closesAtRaw = cleanText(body.closes_at, 80)
      let closesAt: string | null = null

      if (closesAtRaw) {
        const date = new Date(closesAtRaw)
        if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
          return fail(req, 400, 'Closing time must be in the future.')
        }
        closesAt = date.toISOString()
      }

      const shareToken = randomToken(9)
      const runnerKey = randomToken(24)

      const { error } = await supabase.from('runs').insert({
        share_token: shareToken,
        runner_key_hash: await sha256(runnerKey),
        group_name: groupName,
        closes_at: closesAt,
      })

      if (error) throw error

      return json(req, {
        share_token: shareToken,
        runner_key: runnerKey,
        status: 'OPEN',
        closes_at: closesAt,
      }, 201)
    }

    const token = cleanText(body.token, 80)
    if (!token) return fail(req, 400, 'Run token is required.')

    const run = await loadRun(supabase, token)
    if (!run) return fail(req, 404, 'This Kopi Run could not be found.')

    if (action === 'submit_order') {
      if (run.status !== 'OPEN' || isExpired(run)) {
        return fail(req, 409, 'This Kopi Run is already closed.')
      }

      const displayName = cleanText(body.display_name, 40)
      const drink = cleanText(body.drink, 120)

      if (!displayName) return fail(req, 400, 'Your name is required.')
      if (!drink) return fail(req, 400, 'Choose a drink before submitting.')

      const editToken = randomToken(18)
      const { data, error } = await supabase
        .from('orders')
        .insert({
          run_id: run.id,
          display_name: displayName,
          drink,
          edit_token_hash: await sha256(editToken),
        })
        .select('id, display_name, drink, created_at')
        .single()

      if (error) throw error

      return json(req, { order: data, edit_token: editToken }, 201)
    }

    if (action === 'update_order') {
      if (run.status !== 'OPEN' || isExpired(run)) {
        return fail(req, 409, 'This Kopi Run is already closed.')
      }

      const editToken = cleanText(body.edit_token, 160)
      const displayName = cleanText(body.display_name, 40)
      const drink = cleanText(body.drink, 120)

      if (!editToken) return fail(req, 401, 'Edit token is required.')
      if (!displayName || !drink) return fail(req, 400, 'Name and drink are required.')

      const { data: existing, error: lookupError } = await supabase
        .from('orders')
        .select('id, edit_token_hash')
        .eq('run_id', run.id)
        .eq('edit_token_hash', await sha256(editToken))
        .maybeSingle()

      if (lookupError) throw lookupError
      if (!existing) return fail(req, 403, 'This order cannot be edited from this device.')

      const { data, error } = await supabase
        .from('orders')
        .update({ display_name: displayName, drink })
        .eq('id', existing.id)
        .select('id, display_name, drink, created_at, updated_at')
        .single()

      if (error) throw error
      return json(req, { order: data })
    }

    if (action === 'close_run') {
      const runnerKey = cleanText(body.runner_key, 160)
      if (!runnerKey || (await sha256(runnerKey)) !== run.runner_key_hash) {
        return fail(req, 403, 'Runner access is required.')
      }

      const { error } = await supabase
        .from('runs')
        .update({ status: 'CLOSED' })
        .eq('id', run.id)

      if (error) throw error
      return json(req, { status: 'CLOSED' })
    }

    return fail(req, 400, 'Unknown action.')
  } catch (error) {
    console.error(error)
    return fail(req, 500, 'Kopi Run hit a server error.')
  }
})
