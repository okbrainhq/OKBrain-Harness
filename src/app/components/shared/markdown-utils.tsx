import React, { ReactNode } from 'react';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import ImageGallery, { SingleImage, parseImageBlocks } from "../ImageGallery";

const sanitizeSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        span: [...(defaultSchema.attributes?.span || []), 'className'],
        code: [...(defaultSchema.attributes?.code || []), 'className'],
    },
};

function isSafeUrl(url: string): string {
    if (url.startsWith('/') || url.startsWith('#') || url.startsWith('./') || url.startsWith('../')) {
        return url;
    }
    try {
        const parsed = new URL(url);
        if (['http:', 'https:', 'mailto:', 'ftp:'].includes(parsed.protocol)) {
            return url;
        }
        return '';
    } catch {
        return url;
    }
}

const LONG_TOKEN_LENGTH = 56;
const TRUNCATED_TOKEN_LENGTH = 44;
const DOMAIN_LABEL_MAX = 20;

export function unescapeContent(content: string): string {
    return content
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r');
}

export function getTextFromChildren(children: ReactNode): string {
    const childList = Array.isArray(children) ? children : [children];
    return childList
        .map((child) => (typeof child === 'string' || typeof child === 'number') ? String(child) : '')
        .join('')
        .trim();
}

export function truncateToken(token: string, maxLength = TRUNCATED_TOKEN_LENGTH): string {
    if (token.length <= maxLength) return token;
    return `${token.slice(0, maxLength - 1)}…`;
}

export function getUrlDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

export const markdownComponents: any = {
    ul: ({ ...props }: any) => <ul className="markdown-list" {...props} />,
    ol: ({ ...props }: any) => <ol className="markdown-list" {...props} />,
    li: ({ children, ...props }: any) => <li className="markdown-list-item" {...props}>{children}</li>,
    p: ({ children, node, ...props }: any) => {
        // If paragraph contains only an image, render as SingleImage (avoids div-in-p hydration error)
        const childNodes = node?.children?.filter((c: any) => c.type !== 'text' || c.value.trim());
        if (childNodes?.length === 1 && childNodes[0].tagName === 'img') {
            const imgProps = childNodes[0].properties || {};
            return <SingleImage src={imgProps.src || ''} alt={imgProps.alt || ''} width={imgProps.width ? Number(imgProps.width) : undefined} />;
        }
        return <p className="markdown-paragraph" {...props}>{children}</p>;
    },
    strong: ({ ...props }: any) => <strong className="markdown-strong" {...props} />,
    code: ({ inline, children, ...props }: any) => {
        if (!inline) {
            return <code className="markdown-code" {...props}>{children}</code>;
        }
        const text = getTextFromChildren(children);
        const isLongToken = text.length > LONG_TOKEN_LENGTH;
        return (
            <code
                className={`markdown-inline-code ${isLongToken ? 'markdown-long-token' : ''}`}
                title={isLongToken ? text : undefined}
                {...props}
            >
                {isLongToken ? truncateToken(text) : children}
            </code>
        );
    },
    pre: ({ ...props }: any) => <pre className="markdown-pre" {...props} />,
    table: ({ ...props }: any) => <div className="markdown-table-wrapper"><table className="markdown-table" {...props} /></div>,
    thead: ({ ...props }: any) => <thead className="markdown-thead" {...props} />,
    tbody: ({ ...props }: any) => <tbody className="markdown-tbody" {...props} />,
    tr: ({ ...props }: any) => <tr className="markdown-tr" {...props} />,
    th: ({ ...props }: any) => <th className="markdown-th" {...props} />,
    td: ({ ...props }: any) => <td className="markdown-td" {...props} />,
    hr: ({ ...props }: any) => <hr className="markdown-hr" {...props} />,
    a: ({ children, href, ...props }: any) => {
        const text = getTextFromChildren(children);
        const isCitation = /^\[\d+\]$/.test(text) || /^\d+$/.test(text) || text === 'source' || text === '[source]';
        if (isCitation) {
            return (
                <a
                    target="_blank"
                    rel="noopener noreferrer"
                    className="markdown-citation"
                    href={href}
                    {...props}
                >
                    {text.replace(/[\[\]]/g, "")}
                </a>
            );
        }

        const linkText = text || href || '';
        const isRawUrlLink = Boolean(href) && linkText === href;
        const compactLabel = isRawUrlLink
            ? truncateToken(getUrlDomain(href), DOMAIN_LABEL_MAX)
            : truncateToken(linkText);

        return (
            <a
                target="_blank"
                rel="noopener noreferrer"
                className={isRawUrlLink ? "markdown-link markdown-link-domain" : "markdown-link"}
                href={href}
                title={linkText || href}
                {...props}
            >
                <span className="markdown-link-label">
                    {compactLabel}
                </span>
            </a>
        );
    },
};

export function renderOutputSegments(content: string, keyPrefix: string, components?: any): ReactNode[] {
    const comps = components || markdownComponents;
    return parseImageBlocks(unescapeContent(content)).map((segment: any, segIdx) =>
        segment.type === 'images' ? (
            <ImageGallery key={`${keyPrefix}-images-${segIdx}`} images={segment.images} loading={segment.loading} />
        ) : segment.type === 'single-image' ? (
            <SingleImage key={`${keyPrefix}-image-${segIdx}`} src={segment.src} alt={segment.alt} width={segment.width} />
        ) : (
            <ReactMarkdown
                key={`${keyPrefix}-markdown-${segIdx}`}
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight, [rehypeSanitize, sanitizeSchema]]}
                urlTransform={isSafeUrl}
                components={comps}
            >
                {segment.content}
            </ReactMarkdown>
        )
    );
}
