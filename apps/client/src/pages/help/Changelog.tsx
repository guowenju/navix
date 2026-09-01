import React, { useMemo } from "react";
import styled from "styled-components";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const ChangelogContainer = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: hidden;
  color: ${(props) => props.theme.colors.textPrimary};
  background-color: ${(props) => props.theme.colors.background};
`;

const Title = styled.h1`
  flex-shrink: 0;
  color: ${(props) => props.theme.colors.primary};
  border-bottom: 2px solid ${(props) => props.theme.colors.border};
  padding-bottom: 0.5rem;
  margin: 2rem 2rem 0;
`;

const ChangelogScrollArea = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 1.5rem 2rem 2rem;
`;

const MarkdownContent = styled.div`
  color: ${(props) => props.theme.colors.textPrimary};
  line-height: 1.7;

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    color: ${(props) => props.theme.colors.textPrimary};
    font-weight: 700;
    margin: 1.25rem 0 0.75rem;
  }

  h2 {
    font-size: 1.35rem;
    padding-left: 0.75rem;
    border-left: 4px solid ${(props) => props.theme.colors.primary};
  }

  h3 {
    font-size: 1.15rem;
  }

  p {
    margin: 0.75rem 0;
  }

  ul,
  ol {
    margin: 0.75rem 0 1rem;
    padding-left: 1.5rem;
  }

  li {
    margin: 0.35rem 0;
  }

  a {
    color: ${(props) => props.theme.colors.primary};
    font-weight: 500;
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
    filter: brightness(1.1);
  }

  hr {
    border: none;
    border-top: 1px solid ${(props) => props.theme.colors.border};
    margin: 1.5rem 0;
  }

  code {
    font-weight: 700;
    color: ${(props) => props.theme.colors.codeBackground};
    background-color: ${(props) => props.theme.colors.surface};
    padding: 0.15em 0.4em;
    border-radius: 6px;
    font-size: 0.92em;
  }

  pre {
    background-color: ${(props) => props.theme.colors.surface};
    border: 1px solid ${(props) => props.theme.colors.border};
    border-radius: 10px;
    padding: 1rem;
    overflow-x: auto;
  }

  pre code {
    display: block;
    padding: 0;
    background: transparent;
    color: inherit;
    font-weight: 500;
  }
`;

const markdownComponents: Components = {
  a(props) {
    return (
      <a {...props} target="_blank" rel="noreferrer">
        {props.children}
      </a>
    );
  },
};

/**
 * 过滤更新日志中的未发布区段，仅保留已经正式发布的版本内容。
 */
function filterUnreleasedSection(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const unreleasedHeadingIndex = lines.findIndex((line) =>
    /^##[\t ]+\[unreleased\][\t ]*$/i.test(line),
  );

  if (unreleasedHeadingIndex === -1) {
    return markdown;
  }

  const nextVersionHeadingOffset = lines
    .slice(unreleasedHeadingIndex + 1)
    .findIndex((line) =>
      /^##[\t ]+\[(?!unreleased\])[^\]]+\](?:\([^)]*\))?(?:[\t ]+-[\t ].*)?[\t ]*$/i.test(
        line,
      ),
    );
  const nextVersionHeadingIndex =
    nextVersionHeadingOffset === -1
      ? lines.length
      : unreleasedHeadingIndex + nextVersionHeadingOffset + 1;

  return lines.slice(nextVersionHeadingIndex).join("\n");
}

const ChangelogPage: React.FC = () => {
  const { t } = useTranslation();
  const changelogContent = useMemo(
    () => filterUnreleasedSection(__CHANGELOG_CONTENT__),
    [],
  );

  return (
    <ChangelogContainer data-page="changelog">
      <Title data-ui="changelog-title">{t("menu.help.changelog")}</Title>
      <ChangelogScrollArea data-slot="changelog-scroll-area">
        <MarkdownContent>
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {changelogContent}
          </Markdown>
        </MarkdownContent>
      </ChangelogScrollArea>
    </ChangelogContainer>
  );
};

export default ChangelogPage;
