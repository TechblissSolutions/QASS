# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People responsible for researching companies and creating or managing branded marketing content for their own organizations or clients. This includes individual, hands-on content creators and marketers who plan, review, and coordinate content with others.

## Product Purpose

Sparrow by TechBliss is an AI-powered platform that helps users research companies and complete supported workflows, including AI-assisted marketing content creation. Sparrow's website analysis and brand context help users create content for review, refinement, and a path toward publishing.

## Positioning

Sparrow starts with the website and brand context of the company selected for the task, then uses that context to support company research and generate brand-aware marketing content. TechBliss is the company behind Sparrow, not the default subject of users' research or content.

## Operating Context

Users can work with different companies or brands, including their own organizations and clients. The implemented workflows include website analysis and company workspaces, brand data, content creation and editing, and a social planner for managing posts through connected accounts. Available creation tools and publishing options depend on the supported implementation and configured integrations.

## Capabilities and Constraints

- Keep company-specific research, content, and brand settings associated with the appropriate task or selected company.
- Do not hardcode TechBliss as the subject of research or generated content unless the user selects it.
- Preserve working routes, navigation, terminology, authentication, API contracts, and backend integrations. Change navigation or terminology only when implementation or usability evidence supports it.
- Do not claim integrations, customer data, or workflows that are not supported by the implementation.
- The repository documents Next.js, Supabase, n8n, Upstash Redis, Sentry, and Vercel as parts of the current application and deployment architecture. Payment-provider checkout and webhooks are not included in the current billing shell.

## Brand Commitments

- Use “Sparrow by TechBliss” where the full product identity is appropriate.
- Preserve the existing TechBliss logo and brand assets, and use the established TechBliss orange accent and design tokens where available.
- Keep TechBliss product branding distinct from the identity and brand data of the company a user is researching or creating content for.

## Evidence on Hand

- The implementation includes website analysis, multi-company workspaces, brand data, Studio content tools, and a social planner; see `app/analyse`, `app/dashboard`, `app/brand`, `app/studio`, and `app/calendar`.
- `README.md` documents the application architecture, integrations, entitlement limits, and current billing limitations.
- The repository does not establish customer endorsements, performance benchmarks, or other marketing proof. Do not invent them.
- The user identifies TechBliss logo and brand assets as binding, but their canonical asset paths are not established by this product record.

## Product Principles

- Let users choose the company or brand relevant to each task.
- Keep Sparrow's product identity separate from the brands users work with.
- Support both individual creation and coordinated marketing work.
- Preserve existing product behavior and integrations unless evidence justifies a change.

## Accessibility & Inclusion

Maintain responsive layouts, keyboard accessibility, visible focus states, sufficient contrast, and reduced-motion support.
