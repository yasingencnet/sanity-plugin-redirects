import {definePlugin, defineField, defineType} from 'sanity'
import type {StructureBuilder} from 'sanity/structure'
import {RedirectIcon, TestIcon} from './icon.js'
import {REDIRECT_TYPE} from './match.js'
import {RedirectTester} from './tester.js'

export {REDIRECT_TYPE, REDIRECTS_QUERY} from './match.js'
export type {RedirectRule} from './match.js'

/**
 * Editor-managed 301/302 redirects for Sanity, in the spirit of WordPress's
 * Redirection plugin: a list of "this old URL now lives here" rules an SEO
 * team owns, applied by your host with a real redirect status.
 *
 * This entry point is the Studio half — schema and sidebar item. The matcher
 * that applies the rules lives at `sanity-plugin-redirects/match` and pulls in
 * neither Sanity nor React, so it is safe to import into middleware or a
 * Worker. Both halves ship in this one package precisely so you cannot install
 * one and forget the other.
 *
 * What a rule means:
 *   - `/board.shtml` matches that path exactly, ignoring case and any trailing
 *     slash.
 *   - `/old-news/*` matches everything under `/old-news/`; a destination
 *     ending in `/*` receives the matched suffix, otherwise the suffix drops.
 *   - the visitor's query string always carries over.
 *
 * Deliberately absent, and unlikely to be added: hit counting (a database
 * write per redirected visit is the wrong trade at the edge) and regex
 * sources (nearly every real rule is an exact path or a folder move; regex
 * mostly ships foot-guns). A migration that truly needs regex should express
 * it in code, where it can be reviewed and tested.
 */

const PATH_SHAPE = /^\/[^\s?#]*$/

const validPath = (value: string): true | string =>
  PATH_SHAPE.test(value) || 'Must be a path starting with "/", without spaces, "?" or "#"'

export interface RedirectsPluginOptions {
  /**
   * Paths that may never be redirected, because they are your site's own
   * plumbing. Matched as a prefix, case-insensitively.
   *
   * Defaults to `['/api', '/assets', '/_next', '/static']`. Your host should
   * enforce this too — the Studio can only stop rules being written, not rules
   * that already exist.
   */
  reservedPaths?: string[]
  /** Sidebar title. Defaults to 'Redirects'. */
  title?: string
}

const DEFAULT_RESERVED = ['/api', '/assets', '/_next', '/static']

const buildSchema = (options: RedirectsPluginOptions) => {
  const reserved = options.reservedPaths ?? DEFAULT_RESERVED

  return defineType({
    name: REDIRECT_TYPE,
    title: 'Redirect',
    type: 'document',
    icon: RedirectIcon,
    fields: [
      defineField({
        name: 'source',
        title: 'From (old path)',
        type: 'string',
        description:
          'The old URL\'s path, e.g. /board.shtml — everything after the domain. End with /* to match a whole folder: /old-news/* matches every address under /old-news/.',
        validation: (rule) =>
          rule.required().custom<string>((value, context) => {
            if (!value) return 'Required'
            const path = value.trim()
            const bare = path.endsWith('/*') ? path.slice(0, -2) + '/x' : path
            const shape = validPath(bare)
            if (shape !== true) return shape
            if (path.includes('*') && !path.endsWith('/*')) {
              return '* is only allowed at the end, as /*'
            }
            const clash = reserved.find(
              (prefix) =>
                path.toLowerCase() === prefix.toLowerCase() ||
                path.toLowerCase().startsWith(prefix.toLowerCase() + '/'),
            )
            if (clash) {
              return `Paths under ${clash} are the site's own plumbing and cannot be redirected`
            }
            // One rule per source — two rules for one path would race.
            const client = context.getClient({apiVersion: '2024-10-01'})
            const id = context.document?._id.replace(/^drafts\./, '')
            return client
              .fetch<number>(
                `count(*[_type == $type && source == $source && !(_id in [$id, "drafts." + $id])])`,
                {type: REDIRECT_TYPE, source: path, id},
              )
              .then((clashes) =>
                clashes > 0 ? 'Another redirect already uses this source path' : true,
              )
          }),
      }),
      defineField({
        name: 'destination',
        title: 'To (new address)',
        type: 'string',
        description:
          'A path on this site (/leadership) or a full URL (https://example.org/page). If the From ends with /*, ending this with /* carries the rest of the old address across.',
        validation: (rule) =>
          rule.required().custom<string>((value, context) => {
            if (!value) return 'Required'
            const path = value.trim()
            if (/^https?:\/\/\S+$/.test(path)) return true
            const bare = path.endsWith('/*') ? path.slice(0, -2) + '/x' : path
            if (validPath(bare) !== true) {
              return 'Must be a path starting with "/" or a full http(s) URL'
            }
            if (path.includes('*') && !path.endsWith('/*')) {
              return '* is only allowed at the end, as /*'
            }
            const source = (context.document?.source as string | undefined)?.trim()
            if (source && source.replace(/\/$/, '') === path.replace(/\/$/, '')) {
              return 'Points back at itself — this would redirect forever'
            }
            return true
          }),
      }),
      defineField({
        name: 'permanent',
        title: 'Permanent (301)',
        type: 'boolean',
        initialValue: true,
        description:
          'On: a 301, telling search engines the move is final — the norm for a site migration. Off: a 302, for a temporary diversion search engines should not remember.',
      }),
      defineField({
        name: 'enabled',
        title: 'Enabled',
        type: 'boolean',
        initialValue: true,
        description: 'Switch off to keep the rule on file without it doing anything.',
      }),
      defineField({
        name: 'notes',
        title: 'Notes',
        type: 'text',
        rows: 2,
        description: 'For your team — e.g. which old page this was, or why it moved.',
      }),
    ],
    preview: {
      select: {
        source: 'source',
        destination: 'destination',
        permanent: 'permanent',
        enabled: 'enabled',
      },
      prepare({source, destination, permanent, enabled}) {
        return {
          title: `${source ?? '?'} → ${destination ?? '?'}`,
          subtitle: `${permanent === false ? '302' : '301'}${enabled === false ? ' · OFF' : ''}`,
        }
      },
    },
    orderings: [
      {title: 'Source (A–Z)', name: 'sourceAsc', by: [{field: 'source', direction: 'asc'}]},
    ],
  })
}

/**
 * Sidebar entry: every redirect, and the test area. Add to your structure,
 * and add 'redirect' to any hand-maintained list of types you filter out of
 * the default document list.
 *
 *   import {redirectsListItem} from 'sanity-plugin-redirects'
 *   S.list().items([..., redirectsListItem(S)])
 */
export const redirectsListItem = (S: StructureBuilder, options: RedirectsPluginOptions = {}) => {
  const title = options.title ?? 'Redirects'
  return S.listItem()
    .id('redirects')
    .title(title)
    .icon(RedirectIcon)
    .child(
      S.list()
        .id('redirects')
        .title(title)
        .items([
          S.listItem()
            .id('all')
            .title('All redirects')
            .icon(RedirectIcon)
            .child(
              S.documentTypeList(REDIRECT_TYPE)
                .title(title)
                .defaultOrdering([{field: 'source', direction: 'asc'}]),
            ),
          S.listItem()
            .id('test')
            .title('Test an address')
            .icon(TestIcon)
            .child(S.component(RedirectTester).id('test').title('Test an address')),
        ]),
    )
}

/**
 *   import {redirectsPlugin} from 'sanity-plugin-redirects'
 *   export default defineConfig({plugins: [redirectsPlugin()]})
 */
export const redirectsPlugin = definePlugin<RedirectsPluginOptions | void>((options) => ({
  name: 'sanity-plugin-redirects',
  schema: {types: [buildSchema(options || {})]},
}))
