---
name: test-agent
model: gpt-4
tools:
  - name: test-tool
    execution:
      type: shell
      run: echo "tool executed with ${{ args.val }}"
---
You are a test agent.