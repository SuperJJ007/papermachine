import { describe, expect, it } from 'vitest'
import { HarnessHomeSpaceError } from '../src/harness-home.ts'
import { errorPage, errorSurface, harnessHomeSpaceErrorPage, launchErrorPage, RESTART_URL, unsupportedPlatformErrorPage } from '../src/error-page.ts'

/** Decode one of this module's `data:text/html` URLs back to its HTML source. */
function decode(dataUrl: string): string {
  const prefix = 'data:text/html;charset=utf-8,'
  expect(dataUrl.startsWith(prefix)).toBe(true)
  return decodeURIComponent(dataUrl.slice(prefix.length))
}

describe('errorSurface', () => {
  it('renders the heading and detail, escaped', () => {
    const html = decode(errorSurface('<Heading>', 'detail & "quoted"', false))

    expect(html).toContain('<h1>&lt;Heading&gt;</h1>')
    expect(html).toContain('<p>detail &amp; &quot;quoted&quot;</p>')
  })

  it('includes the Restart Host link only when requested', () => {
    expect(decode(errorSurface('h', 'd', true))).toContain(`href="${RESTART_URL}"`)
    expect(decode(errorSurface('h', 'd', false))).not.toContain(RESTART_URL)
  })

  it('names the Host log path when given one, escaped', () => {
    const withPath = decode(errorSurface('h', 'd', true, '/Users/me/.papermachine/logs/host.log'))
    expect(withPath).toContain('/Users/me/.papermachine/logs/host.log')

    const withoutPath = decode(errorSurface('h', 'd', true))
    expect(withoutPath).not.toContain('Host log')
  })
})

describe('errorPage', () => {
  it('reports an unnamed unavailable Host when neither exit nor reason is given', () => {
    expect(decode(errorPage(undefined))).toContain('<p>Host unavailable</p>')
  })

  it('reports the exit code or signal when given an exit and no reason', () => {
    expect(decode(errorPage(undefined, { code: 9, signal: null }))).toContain('<p>Host stopped (9)</p>')
    expect(decode(errorPage(undefined, { code: null, signal: 'SIGKILL' }))).toContain('<p>Host stopped (SIGKILL)</p>')
  })

  it('prefers an explicit reason over the exit', () => {
    expect(decode(errorPage(undefined, { code: 9, signal: null }, 'boom'))).toContain('<p>boom</p>')
  })

  it('names the given Host log path', () => {
    expect(decode(errorPage('/dsh-home/logs/host.log'))).toContain('/dsh-home/logs/host.log')
  })
})

describe('harnessHomeSpaceErrorPage', () => {
  it('omits the Restart Host action and any Host log path', () => {
    const html = decode(harnessHomeSpaceErrorPage(new HarnessHomeSpaceError('/a user/.papermachine')))

    expect(html).toContain('PaperMachine cannot start')
    expect(html).toContain('/a user/.papermachine')
    expect(html).not.toContain(RESTART_URL)
    expect(html).not.toContain('Host log')
  })
})

describe('launchErrorPage', () => {
  it('routes a HarnessHomeSpaceError to the dedicated space-in-home page', () => {
    const html = decode(launchErrorPage('/dsh-home/logs/host.log', new HarnessHomeSpaceError('/a user/.papermachine')))

    expect(html).toContain('PaperMachine cannot start')
    expect(html).not.toContain('/dsh-home/logs/host.log')
  })

  it('routes any other Error to the general Host error page with its message and the log path', () => {
    const html = decode(launchErrorPage('/dsh-home/logs/host.log', new Error('launch failed')))

    expect(html).toContain('<p>launch failed</p>')
    expect(html).toContain('/dsh-home/logs/host.log')
  })

  it('stringifies a non-Error thrown value', () => {
    expect(decode(launchErrorPage(undefined, 'raw string failure'))).toContain('<p>raw string failure</p>')
  })
})

describe('unsupportedPlatformErrorPage', () => {
  it('renders honest Windows analysis explanation without Restart Host link', () => {
    const html = decode(unsupportedPlatformErrorPage())

    expect(html).toContain('PaperMachine Analysis Not Supported on Windows')
    expect(html).toContain('environment was not downloaded')
    expect(html).not.toContain(RESTART_URL)
  })
})
