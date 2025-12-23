/**
 * Prompts the user for a secret/password input, masking the characters with *.
 * @param promptText The text to display before the input
 * @returns The secret string entered by the user
 */
export async function promptSecret(promptText: string): Promise<string> {
  const { stdin, stdout } = process;

  if (!stdin.isTTY) {
    // Non-interactive mode: just read a line
    stdout.write(promptText);
    const readline = require('node:readline');
    const rl = readline.createInterface({
      input: stdin,
      terminal: false,
    });

    return new Promise((resolve) => {
      rl.on('line', (line: string) => {
        rl.close();
        resolve(line.trim());
      });

      rl.on('close', () => {
        resolve('');
      });
    });
  }

  return new Promise((resolve) => {
    stdout.write(promptText);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let input = '';

    const handler = (char: string) => {
      // Ctrl+C (End of Text)
      if (char === '\u0003') {
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write('\n^C\n');
        process.exit(130);
      }

      // Enter (Carriage Return)
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', handler);
        stdout.write('\n');
        resolve(input);
        return;
      }

      // Backspace
      if (char === '\u007f' || char === '\u0008') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          stdout.write('\b \b'); // Move back, overwrite with space, move back again
        }
        return;
      }

      // Normal characters
      if (char.length === 1 && char.charCodeAt(0) >= 32) {
        input += char;
        stdout.write('*');
      }
    };

    stdin.on('data', handler);
  });
}
