const STORY_PROJECT_PATTERN = /^(.+)-\d+$/;

export const projectKeyOfStory = (storyKey: string): string => STORY_PROJECT_PATTERN.exec(storyKey)?.[1] ?? storyKey;
