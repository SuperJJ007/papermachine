import { describe, expect, it } from 'vitest'
import { HarnessHomeSpaceError } from '../src/harness-home.ts'
import {
  CHOOSE_INSTALL_LOCATION_URL,
  errorPage,
  errorSurface,
  harnessHomeSpaceErrorPage,
  installLocationUnavailableErrorPage,
  launchErrorPage,
  QUIT_URL,
  RESTART_URL,
  USE_DEFAULT_INSTALL_LOCATION_URL,
} from '../src/error-page.ts'

/** Decode one of this module's `data:text/html` URLs back to its HTML source. */
function decode(dataUrl: string): string {
  const prefix = 'data:text/html;charset=utf-8,'
  expect(dataUrl.startsWith(prefix)).toBe(true)
  return decodeURIComponent(dataUrl.slice(prefix.length))
}

describe('errorSurface', () => {
  it('renders the heading and detail, escaped', () => {
    const html = decode(errorSurface('<Heading>', 'detail & "quoted"', []))

    expect(html).toContain('<h1>&lt;Heading&gt;</h1>')
    expect(html).toContain('<p>detail &amp; &quot;quoted&quot;</p>')
  })

  it('renders every given action link, in order, and none when empty', () => {
    const html = decode(errorSurface('h', 'd', [
      { label: 'First', href: 'dsh-desktop://first' },
      { label: 'Second', href: 'dsh-desktop://second' },
    ]))
    expect(html.indexOf('dsh-desktop://first')).toBeLessThan(html.indexOf('dsh-desktop://second'))
    expect(decode(errorSurface('h', 'd', []))).not.toContain('<a href')
  })

  it('names the Host log path when given one, escaped', () => {
    const withPath = decode(errorSurface('h', 'd', [], '/Users/me/.papermachine/logs/host.log'))
    expect(withPath).toContain('/Users/me/.papermachine/logs/host.log')

    const withoutPath = decode(errorSurface('h', 'd', []))
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

  it('offers "Choose another location" and "Quit" — this failure has no default location to fall back to', () => {
    const html = decode(harnessHomeSpaceErrorPage(new HarnessHomeSpaceError('/a user/.papermachine')))

    expect(html).toContain(`href="${CHOOSE_INSTALL_LOCATION_URL}"`)
    expect(html).toContain(`href="${QUIT_URL}"`)
    expect(html).not.toContain(USE_DEFAULT_INSTALL_LOCATION_URL)
  })

  it('appends a rejection reason when reloaded after a declined re-selection, without losing the original error', () => {
    const html = decode(harnessHomeSpaceErrorPage(
      new HarnessHomeSpaceError('/a user/.papermachine'),
      'The chosen folder\'s path contains a space ("/also a user/PaperMachine").',
    ))

    expect(html).toContain('/a user/.papermachine')
    expect(html).toContain('/also a user/PaperMachine')
  })
})

describe('installLocationUnavailableErrorPage', () => {
  it('names the pointer file, the unreachable target, and the underlying reason', () => {
    const html = decode(installLocationUnavailableErrorPage('/Users/me/.papermachine-home', '/Volumes/Data/PaperMachine', 'ENOENT: no such file or directory'))

    expect(html).toContain('/Users/me/.papermachine-home')
    expect(html).toContain('/Volumes/Data/PaperMachine')
    expect(html).toContain('ENOENT: no such file or directory')
  })

  it('offers "Use default location" and "Quit" instead of Restart Host, and no Host log path', () => {
    const html = decode(installLocationUnavailableErrorPage('/Users/me/.papermachine-home', '/Volumes/Data/PaperMachine', 'boom'))

    expect(html).toContain(`href="${USE_DEFAULT_INSTALL_LOCATION_URL}"`)
    expect(html).toContain(`href="${QUIT_URL}"`)
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
