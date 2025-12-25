export interface TestDefinition {
    name: string;
    workflow: string; // Name or path
    fixture: {
        inputs?: Record<string, unknown>;
        env?: Record<string, string>;
        secrets?: Record<string, string>;
        mocks?: Array<{
            step?: string;
            type?: string;
            prompt?: string;
            // biome-ignore lint/suspicious/noExplicitAny: Mock responses can be any type
            response: any;
        }>;
    };
    snapshot?: {
        steps: Record<
            string,
            {
                status: string;
                // biome-ignore lint/suspicious/noExplicitAny: Step outputs can be any type
                output: any;
                error?: string;
            }
        >;
        // biome-ignore lint/suspicious/noExplicitAny: Workflow outputs can be any type
        outputs: Record<string, any>;
    };
}
