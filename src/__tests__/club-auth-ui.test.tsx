import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SignInPage from '@/app/club/sign-in/page'

describe('sign-in before browser hydration', () => {
  it('disables credentials and prevents native GET submission', () => {
    const markup = renderToStaticMarkup(<SignInPage />)

    expect(markup).toMatch(/<form[^>]*method="post"/)
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/)
    expect(markup).toContain('type="password"')
  })
})
