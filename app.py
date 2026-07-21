import os
from openai import OpenAI

client = OpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key="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",
)

completion = client.chat.completions.create(
    model="Qwen/Qwen2.5-7B-Instruct:together",
    messages=[
        {
            "role": "user",
            "content": "Hey! How can i help You."
        }
    ],
)

print(completion.choices[0].message)