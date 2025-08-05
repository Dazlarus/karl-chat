import { ChatPromptTemplate, StrOutputParser } from 'langchain_core';
import { ChatPromptTemplate, StrOutputParser } from 'langchain/core';
import config from './config'; // Adjust the path if your config file is elsewhere
const model_local = ChatOllama({ 
  model: config['DEFAULT_MODEL'], 
  baseUrl: "http://" + config['OLLAMA_HOST'] + ":" + config['OLLAMA_PORT'] });

function query(question) {
  const promptTemplate = ChatPromptTemplate.from_template("What is {topic} in under 100 words?");
  const prompt = promptTemplate.format({ topic: question });
  const outputParser = StrOutputParser();
  const chain = async () => {
    const modelResponse = await model_local.invoke(prompt);
    const parsedResponse = outputParser.parse(modelResponse);
    return parsedResponse;
  };

  // You may want to handle errors here, or at the UI level.
  return async () => {
    const response = await chain();
    console.log(response);
    // Return the response for use in the UI
    return response;
  }
}

export default query;
