// leitor de qr code

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const atendimentosAtivos = {};
const estados = {};
const protocolos = {}; // Armazena o protocolo gerado por número

const contadorPath = path.join(__dirname, 'contador.json');
const planilhaPath = path.join(__dirname, 'conversas_chatbot.xlsx');

function carregarContador() {
    if (!fs.existsSync(contadorPath)) {
        fs.writeFileSync(contadorPath, JSON.stringify({ data: '', contador: 0 }));
    }
    const data = fs.readFileSync(contadorPath);
    return JSON.parse(data);
}

function salvarContador(dados) {
    fs.writeFileSync(contadorPath, JSON.stringify(dados));
}

function gerarProtocolo() {
    const agora = new Date();
    const dia = String(agora.getDate()).padStart(2, '0');
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const ano = String(agora.getFullYear()).slice(2);
    const hora = String(agora.getHours()).padStart(2, '0');
    const minuto = String(agora.getMinutes()).padStart(2, '0');

    const dataAtual = `  ${dia}${mes}${ano}`;
    const contadorData = carregarContador();

    if (contadorData.data !== dataAtual) {
        contadorData.data = dataAtual;
        contadorData.contador = 1;
    } else {
        if (contadorData.contador >= 100) {
            return null;
        }
        contadorData.contador += 1;
    }

    salvarContador(contadorData);
    const id = String(contadorData.contador).padStart(3, '0');
    return `${dia}${mes}${ano}${hora}${minuto}${id}`;
}

function registrarNaPlanilha(protocolo, nome, numero, mensagem, origem = 'Cliente') {
    let planilha;
    if (fs.existsSync(planilhaPath)) {
        const wb = xlsx.readFile(planilhaPath);
        planilha = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    } else {
        planilha = [];
    }

    const dataHora = new Date().toLocaleString();
    planilha.push({
        Protocolo: protocolo,
        DataHora: dataHora,
        Nome: nome,
        Numero: numero,
        Mensagem: mensagem,
        Origem: origem
    });

    const ws = xlsx.utils.json_to_sheet(planilha, {
        header: ['Protocolo', 'DataHora', 'Nome', 'Numero', 'Mensagem', 'Origem']
    });
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, "Conversas");
    xlsx.writeFile(wb, planilhaPath);
}

const qrcode = require('qrcode');
const { Client, Buttons, List, MessageMedia } = require('whatsapp-web.js');
const client = new Client({
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});


client.on('qr', qr => {
    qrcode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error('Erro ao gerar QR:', err);
        } else {
            console.log('Abra este link para escanear o QR Code:');
            console.log(url);
        }
    });
});


client.on('ready', () => {
    console.log('Tudo certo! WhatsApp conectado.');
});

client.initialize();

const delay = ms => new Promise(res => setTimeout(res, ms));

client.on('message', async msg => {
    const agora = Date.now();
    const tempoDeEspera = 15 * 60 * 1000;
    const estadoAtual = estados[msg.from] || 'menu_principal';

    const contact = await msg.getContact();
    const nome = contact.pushname || 'Sem nome';
    let protocolo = protocolos[msg.from] || null;

    if (protocolo) {
        registrarNaPlanilha(protocolo, nome, msg.from, msg.body, 'Cliente');
    }

    if (
        msg.body.match(/(menu|Menu|dia|tarde|noite|oi|Oi|Olá|olá|ola|Ola)/i) &&
        msg.from.endsWith('@c.us')
    ) {
        const ultimoAtendimento = atendimentosAtivos[msg.from];
        if (ultimoAtendimento && (agora - ultimoAtendimento) < tempoDeEspera) return;

        atendimentosAtivos[msg.from] = agora;

        protocolo = gerarProtocolo();
        if (!protocolo) {
            const resposta = 'Desculpe, o limite de atendimentos com protocolo foi atingido hoje. Por favor, tente novamente amanhã.';
            await client.sendMessage(msg.from, resposta);
            registrarNaPlanilha('N/A', 'Bot', msg.from, resposta, 'Bot');
            return;
        }

        protocolos[msg.from] = protocolo;
        registrarNaPlanilha(protocolo, nome, msg.from, msg.body, 'Cliente');

        const log = `Protocolo: ${protocolo} | Nome: ${nome} | Número: ${msg.from} | Mensagem: ${msg.body}\n`;
        fs.appendFileSync('logs-protocolos.txt', log);

        const chat = await msg.getChat();
        await delay(3000);
        await chat.sendStateTyping();
        await delay(3000);
        const resposta = `Olá ${nome.split(" ")[0]}! Sou o assistente virtual da empresa.\n\nSeu protocolo de atendimento é: *${protocolo}*\n\nComo posso te ajudar hoje? Escolha uma opção:\n\n1 - RH\n2 - Uniforme\n3 - Operacional\n4 - Reclamações\n5 - Falar com atendente`;
        await client.sendMessage(msg.from, resposta);
        registrarNaPlanilha(protocolo, 'Bot', msg.from, resposta, 'Bot');
        estados[msg.from] = 'menu_principal';
        return;
    }

    if (estadoAtual === 'menu_principal') {
        if (msg.body === '1') {
            await client.sendMessage(msg.from, `Você escolheu RH. Escolha uma opção:
1 - Pagamentos
2 - Uniformes
3 - Voltar`);
            estados[msg.from] = 'submenu_rh';
            return;
        }
        if (msg.body === '2') {
            await client.sendMessage(msg.from, `Você escolheu Uniforme. Escolha uma opção:
1 - Retirada de uniforme
2 - Substituição
3 - Voltar`);
            estados[msg.from] = 'submenu_uniformes';
            return;
        }
        if (msg.body === '3') {
            await client.sendMessage(msg.from, `Você escolheu Operacional. Escolha uma opção:
1 - Avisar falta
2 - Reciclagem
3 - Voltar`);
            estados[msg.from] = 'submenu_operacional';
            return;
        }
        if (msg.body === '4') {
            await client.sendMessage(msg.from, `Você escolheu Reclamações. Escolha uma opção:
1 - Registrar reclamação
2 - Acompanhar protocolo de atendimento
3 - Voltar`);
            estados[msg.from] = 'submenu_reclamacoes';
            return;
        }
        if (msg.body === '5') {
            await client.sendMessage(msg.from, `Você será transferido para um atendente humano. Aguarde um momento... 👩‍💼`);
            return;
        }
    }

    if (estadoAtual === 'submenu_rh') {
        if (msg.body === '1') {
            await client.sendMessage(msg.from, `Você escolheu Pagamentos. Escolha:
1 - Salário
2 - Extra
3 - Vale Alimentação
4 - Voltar`);
            estados[msg.from] = 'submenu_pagamentos';
            return;
        }
        if (msg.body === '2') {
            await client.sendMessage(msg.from, `Você escolheu Uniformes. Escolha:
1 - Retirada
2 - Substituição
3 - Voltar`);
            estados[msg.from] = 'submenu_uniformes';
            return;
        }
        if (msg.body === '3') {
            estados[msg.from] = 'menu_principal';
            await client.sendMessage(msg.from, `Você voltou ao menu principal.

1 - RH
2 - Uniforme
3 - Operacional
4 - Reclamações
5 - Falar com atendente`);
            return;
        }
    }

    if (estadoAtual === 'submenu_pagamentos') {
        if (msg.body === '1') {
            await client.sendMessage(msg.from, `O pagamento será realizado no dia 5 deste mês.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '2') {
            await client.sendMessage(msg.from, `Informações sobre horas extras serão fornecidas pelo RH.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '3') {
            await client.sendMessage(msg.from, `O vale alimentação é creditado no início de cada mês.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '4') {
            estados[msg.from] = 'menu_principal';
            await client.sendMessage(msg.from, `Você voltou ao menu principal.

1 - RH
2 - Uniforme
3 - Operacional
4 - Reclamações
5 - Falar com atendente`);
        }
        return;
    }

    if (estadoAtual === 'submenu_uniformes') {
        if (msg.body === '1') {
            await client.sendMessage(msg.from, `Você escolheu Retirada. Escolha:
1 - Segundo uniforme
2 - Terceiro uniforme
3 - Mais uniforme
4 - Voltar`);
            estados[msg.from] = 'submenu_retirada';
            return;
        }
        if (msg.body === '2') {
            await client.sendMessage(msg.from, `Você escolheu Substituição. Escolha:
1 - Por prazo
2 - Por defeito
3 - Por desgaste precoce
4 - Voltar`);
            estados[msg.from] = 'submenu_substituicao';
            return;
        }
        if (msg.body === '3') {
            estados[msg.from] = 'menu_principal';
            await client.sendMessage(msg.from, `Você voltou ao menu principal.

1 - RH
2 - Uniforme
3 - Operacional
4 - Reclamações
5 - Falar com atendente`);
            return;
        }
    }

    if (estadoAtual === 'submenu_retirada') {
        if (msg.body === '1') {
            await client.sendMessage(msg.from, `Pedido de segundo uniforme registrado.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '2') {
            await client.sendMessage(msg.from, `Pedido de terceiro uniforme registrado.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '3') {
            await client.sendMessage(msg.from, `Mais uniformes podem ser solicitados diretamente com o RH.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '4') {
            estados[msg.from] = 'menu_principal';
            await client.sendMessage(msg.from, `Você voltou ao menu principal.

1 - RH
2 - Uniforme
3 - Operacional
4 - Reclamações
5 - Falar com atendente`);
        }
        return;
    }

    if (estadoAtual === 'submenu_substituicao') {
        if (msg.body === '1') {
            await client.sendMessage(msg.from, `Substituição por prazo será analisada.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '2') {
            await client.sendMessage(msg.from, `Substituição por defeito em análise.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '3') {
            await client.sendMessage(msg.from, `Substituição por desgaste precoce registrada.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '4') {
            estados[msg.from] = 'menu_principal';
            await client.sendMessage(msg.from, `Você voltou ao menu principal.

1 - RH
2 - Uniforme
3 - Operacional
4 - Reclamações
5 - Falar com atendente`);
        }
        return;
    }

    if (estadoAtual === 'submenu_operacional') {
        if (msg.body === '1') await client.sendMessage(msg.from, `Falta registrada.`);
        else if (msg.body === '2') await client.sendMessage(msg.from, `Reciclagem agendada.`);
        else if (msg.body === '3') {
            estados[msg.from] = 'menu_principal';
            await client.sendMessage(msg.from, `Você voltou ao menu principal.

1 - RH
2 - Uniforme
3 - Operacional
4 - Reclamações
5 - Falar com atendente`);
        }
        return;
    }

    if (estadoAtual === 'submenu_reclamacoes') {
        if (msg.body === '1') {
            await client.sendMessage(msg.from, `Ok! Por favor, envie sua reclamação aqui abaixo. Ela será salva e encaminhada para um atendente humano, que responderá o mais breve possível.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '2') {
            await client.sendMessage(msg.from, `Seu protocolo está sendo analisado. Um atendente irá acompanhar e entrar em contato se necessário.

Digite 0 para voltar ao menu principal.`);
            estados[msg.from] = 'aguardando_voltar';
        } else if (msg.body === '3') {
            estados[msg.from] = 'menu_principal';
            await client.sendMessage(msg.from, `Você voltou ao menu principal.

1 - RH
2 - Uniforme
3 - Operacional
4 - Reclamações
5 - Falar com atendente`);
        }
        return;
    }

    if (estadoAtual === 'aguardando_voltar' && msg.body === '0') {
        estados[msg.from] = 'menu_principal';
        await client.sendMessage(msg.from, `Você voltou ao menu principal.

1 - RH
2 - Uniforme
3 - Operacional
4 - Reclamações
5 - Falar com atendente`);
        return;
    }

    if (estadoAtual === 'aguardando_voltar') {
        const data = new Date().toLocaleString();
        const logReclamacao = `RECLAMAÇÃO | ${data} | ${msg.from} | ${msg.body}\n`;
        fs.appendFileSync('logs-reclamacoes.txt', logReclamacao);
        await client.sendMessage(msg.from, `Obrigado. Sua mensagem foi registrada.

Digite 0 para voltar ao menu principal.`);
        return;
    }

    if (estadoAtual !== 'menu_principal') {
        await client.sendMessage(msg.from, `❌ Opção inválida. Por favor, digite o número correspondente a uma das opções ou digite "menu" para reiniciar.`)
    }
    })
