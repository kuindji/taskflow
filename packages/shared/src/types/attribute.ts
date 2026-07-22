export interface Attribute {
    id: string;
    name: string;
    value: string;
}

export type AttributeScope = "project" | "parent" | "task";

export interface ResolvedAttribute extends Attribute {
    scope: AttributeScope;
}

export interface AttributeLayer {
    scope: AttributeScope;
    attributes: Attribute[];
}
